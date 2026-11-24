import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  applyProjectDisplayOrder,
  applyProjectInsertions,
  compareProjectDisplayOrder,
  mergeProjectOrder,
  moveProjectInOrder,
} from '../lib/project-order.ts'

function pageFunctions(page) {
  const source = ts.createSourceFile(page, readFileSync(new URL(`../app/${page}/page.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes = {}
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['handleSetProjectHidden', 'handleEditProject', 'handleMoveProject', 'mergeProjectLists', 'createProjectInCategory', 'sortedProjects'].includes(node.name.getText(source))) {
      nodes[node.name.getText(source)] = node.initializer.getText(source)
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
      const fn = node.arguments[0].getText(source)
      if (fn.includes('setScopedHiddenProjects(hidden)')) nodes.hiddenSubscription = fn
      if (fn.includes('subscribeProjectsWithTasksByProjectIds(selectedHiddenProjectIds')) nodes.selectedSubscription = fn
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return (name, context) => vm.runInNewContext(ts.transpileModule(`(${nodes[name]})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

function serviceFunction(service, name, context) {
  const source = ts.createSourceFile(service, readFileSync(new URL(`../lib/${service}.ts`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  const expression = declaration.getText(source).replace(/^export /, '')
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

test('insertion keeps existing projects and their ranks when order values tie or are absent', () => {
  const projects = [
    { id: 'si', displayOrder: 4 },
    { id: 'tied', displayOrder: 4 },
    { id: 'unranked' },
  ]
  const child = { id: 'new', insertAfterProjectId: 'si' }
  const next = { id: 'next', insertAfterProjectId: 'new' }
  const end = { id: 'end', insertAfterProjectId: null }
  assert.deepEqual(applyProjectInsertions([next, ...projects, child, end]),
    [projects[0], child, next, projects[1], projects[2], end])
  assert.deepEqual(projects.map(project => project.displayOrder), [4, 4, undefined])
})

test('explicit shared and ICT personal moves override a project insertion', () => {
  const anchor = { id: 'anchor' }
  const first = { id: 'first', insertAfterProjectId: 'anchor', displayOrder: 0 }
  const personal = { id: 'personal', insertAfterProjectId: 'anchor' }
  const projects = [first, personal, anchor]
  assert.deepEqual(applyProjectInsertions(projects, new Map([['personal', 0]])), projects)
})

test('projects remain visible if the saved anchor is absent', () => {
  const projects = [{ id: 'new', insertAfterProjectId: 'unavailable' }, { id: 'visible' }]
  assert.deepEqual(applyProjectInsertions(projects).map(project => project.id), ['visible', 'new'])
})

test('a newer project occupies the saved slot without rearranging earlier insertions', () => {
  const anchor = { id: 'anchor' }
  const earlier = { id: 'earlier', insertAfterProjectId: 'anchor', createdAt: new Date(2026, 10, 23) }
  const newer = { id: 'newer', insertAfterProjectId: 'anchor', createdAt: new Date(2026, 10, 24) }
  const end = { ...earlier, id: 'end', insertAfterProjectId: null }
  const newEnd = { ...newer, id: 'new-end', insertAfterProjectId: null }
  assert.deepEqual(
    applyProjectInsertions([newEnd, earlier, end, anchor, newer]).map(project => project.id),
    ['anchor', 'newer', 'earlier', 'end', 'new-end'],
  )
})

test('project drops place the dragged project on the chosen side and leave filtered slots in place', () => {
  const projects = Object.freeze(['first', 'hidden', 'second', 'third', 'last'])
  const visible = Object.freeze(['first', 'second', 'third', 'last'])
  const drop = (source, targetProjectId, position) => moveProjectInOrder(projects, source, { targetProjectId, position }, visible)

  assert.deepEqual(drop('last', 'first', 'before'), ['last', 'hidden', 'first', 'second', 'third'])
  assert.deepEqual(drop('first', 'last', 'after'), ['second', 'hidden', 'third', 'last', 'first'])
  assert.deepEqual(drop('first', 'third', 'before'), ['second', 'hidden', 'first', 'third', 'last'])
  assert.deepEqual(drop('last', 'second', 'after'), ['first', 'hidden', 'second', 'last', 'third'])
  assert.equal(drop('second', 'first', 'after'), null)
  assert.equal(drop('first', 'second', 'before'), null)
  assert.equal(drop('first', 'first', 'after'), null)
  assert.equal(drop('first', 'hidden', 'after'), null)
  assert.equal(drop('hidden', 'first', 'before'), null)
})

for (const page of ['work-management', 'fa-work-management', 'ict-work-management']) {
  test(page + ': creation saves only the new row placement in every sort mode', async () => {
    const get = pageFunctions(page)
    const projects = Object.freeze([
      { id: 'later-name', name: 'Zulu', type: 'SI', displayOrder: 4, tasks: [] },
      { id: 'other', name: 'Middle', type: 'R&D', displayOrder: 4, tasks: [] },
      { id: 'earlier-name', name: 'Alpha', type: 'SI', tasks: [] },
      { id: 'end', name: 'Omega', type: 'Etc', tasks: [] },
    ].map(Object.freeze))
    for (const sortBy of ['latest', 'type', 'name', 'progress']) {
      const writes = []
      const context = {
        projectList: projects, sortBy, ictProjectOrderIds: ['later-name', 'other', 'earlier-name'],
        useMemo: compute => compute(), flattenTasks: tasks => tasks,
        applyProjectInsertions, compareProjectDisplayOrder,
        addProjectToDB: async (...args) => { writes.push(args); return 'new' },
        setSortBy: () => assert.fail('Creation must preserve the selected sort mode'),
      }
      const sorted = get('sortedProjects', context)
      if (sortBy === 'type') assert.deepEqual(Array.from(sorted).filter(p => p.type === 'SI').map(p => p.id),
        ['earlier-name', 'later-name'])
      const anchor = Array.from(sorted).findLast(project => project.type === 'SI')
      const created = await get('createProjectInCategory', { ...context, sortedProjects: sorted })(
        { name: 'Aardvark', type: 'SI', tasks: [] },
      )
      assert.equal(created.insertAfterProjectId, anchor.id)
      assert.equal(writes.length, 1)
      assert.equal(writes[0].length, 1)
      assert.equal(writes[0][0].displayOrder, undefined)
      const updated = Array.from(get('sortedProjects', {
        ...context, projectList: [...projects, { ...writes[0][0], id: created.id }],
      }))
      const newIndex = updated.indexOf(anchor) + 1
      assert.equal(updated[newIndex].id, 'new')
      assert.deepEqual(updated.filter(project => project.id !== 'new'), Array.from(sorted))
    }
  })
}

for (const page of ['work-management', 'fa-work-management']) {
  test(page + ': move a restored project by the displayed rows and persist across hidden-list refresh', async () => {
    const first = { id: 'first', displayOrder: 0 }
    const hidden = { id: 'hidden', displayOrder: 1, isHidden: true }
    const neighbor = { id: 'neighbor', displayOrder: 2 }
    const restored = { id: 'restored', displayOrder: 3, isHidden: false }
    const writes = [], pendingUpdates = [], saving = []
    const service = page === 'work-management' ? 'firestore-service' : 'firestore-service-fa'
    const store = new Map([['preferences/dashboard', { sortBy: 'name', otherSetting: true }]])
    const storeContext = {
      db: {}, PROJECTS_COLLECTION: 'projects', SETTINGS_COLLECTION: 'preferences', DASHBOARD_PREFERENCES_DOC: 'dashboard',
      doc: (_db, collection, id) => `${collection}/${id}`,
      serverTimestamp: () => 'timestamp',
      getDoc: async path => ({ data: () => store.get(path) }),
      toStringOrEmpty: value => value ?? '',
      projectDocCache: new Map(),
      writeBatch: () => {
        const operations = []
        const stage = (path, data) => operations.push([path, data])
        return {
          update: stage,
          set: (path, data, options) => { assert.equal(options.merge, true); stage(path, data) },
          commit: async () => {
            writes.push(operations.map(([path]) => path))
            for (const [path, data] of operations) store.set(path, { ...store.get(path), ...data })
          },
        }
      },
    }
    if (service === 'firestore-service') storeContext.isDashboardSortBy = serviceFunction(service, 'isDashboardSortBy', {})
    let scopedHidden = [{ ...hidden, displayOrder: 9 }]
    const context = {
      isSavingProjectOrder: false,
      sortBy: 'name',
      sortedProjects: [first, hidden, neighbor, restored],
      visibleProjectListRef: { current: [first, neighbor, restored] },
      selectedHiddenProjectListRef: { current: [hidden] },
      hiddenTaskDetailsRef: { current: [] },
      moveProjectInOrder, applyProjectDisplayOrder,
      mergeProjectTaskDetails: projects => projects,
      setScopedHiddenProjects: update => { scopedHidden = update(scopedHidden) },
      setProjectList: updater => pendingUpdates.push(updater),
      setIsSavingProjectOrder: value => saving.push(value),
      setSortBy: update => assert.equal(update('name'), 'latest'),
      updateProjectOrdersInDB: serviceFunction(service, 'updateProjectOrdersInDB', storeContext),
      toast: { error: () => assert.fail('Unexpected error'), success() {} },
    }
    const get = pageFunctions(page)
    await get('handleMoveProject', context)('restored', { targetProjectId: 'neighbor', position: 'before' }, ['first', 'neighbor', 'restored'])
    assert.deepEqual(writes, [['projects/first', 'projects/hidden', 'projects/restored', 'projects/neighbor', 'preferences/dashboard']])
    assert.deepEqual(saving, [true, false])
    const appended = [first, neighbor, restored, hidden]
    assert.equal(pendingUpdates[0](appended).find(project => project.id === 'restored').displayOrder, 2)

    const merge = get('mergeProjectLists', context)
    const afterClearingHiddenSelection = merge(context.visibleProjectListRef.current, [])
    assert.deepEqual(
      [...afterClearingHiddenSelection].sort((a, b) => a.displayOrder - b.displayOrder).map(project => project.id),
      ['first', 'restored', 'neighbor'],
    )
    assert.equal(context.selectedHiddenProjectListRef.current[0].displayOrder, 1)
    assert.equal(scopedHidden[0].displayOrder, 1)

    const savedSortBy = await serviceFunction(service, 'fetchDashboardSortBy', storeContext)()
    assert.equal(savedSortBy, 'latest')
    assert.equal(store.get('preferences/dashboard').otherSetting, true)
    const reloaded = get('sortedProjects', {
      projectList: appended.map(project => ({ ...project, ...store.get(`projects/${project.id}`) })),
      sortBy: savedSortBy, useMemo: compute => compute(), compareProjectDisplayOrder, applyProjectInsertions,
    })
    assert.deepEqual(Array.from(reloaded, project => project.id), ['first', 'hidden', 'restored', 'neighbor'])
  })
}

test('ICT: reordering while a project is hidden preserves its saved slot when shown again', async () => {
  const get = pageFunctions('ict-work-management')
  const service = 'firestore-service'
  let profile = { ictProjectOrderIds: ['first', 'hidden', 'neighbor', 'restored'], taskAliases: ['Example'] }
  const storeContext = {
    db: {}, USER_PROFILES_COLLECTION: 'profiles', ICT_PROJECT_ORDER_IDS_FIELD: 'ictProjectOrderIds', ICT_PROJECT_SORT_BY_FIELD: 'ictProjectSortBy',
    doc: (_db, collection, id) => `${collection}/${id}`,
    normalizeEmail: email => email.trim().toLowerCase(), permissionDocId: email => email,
    serverTimestamp: () => 'timestamp',
    compactObject: serviceFunction(service, 'compactObject', {}),
    uniqueTrimmedStrings: serviceFunction(service, 'uniqueTrimmedStrings', {}),
    isDashboardSortBy: serviceFunction(service, 'isDashboardSortBy', {}),
    setDoc: async (path, data, options) => {
      assert.equal(path, 'profiles/user@example.com')
      assert.equal(options.merge, true)
      profile = { ...profile, ...data }
    },
    onSnapshot: (_path, callback) => {
      callback({ exists: () => true, data: () => profile })
      return () => {}
    },
    GANTT_FIELD_MAP: { ict: { projectOrder: 'ictProjectOrderIds' } },
    toNumberOr: (_raw, fallback) => fallback,
    DEFAULT_GANTT_LEFT_PANEL_WIDTH: 0, DEFAULT_GANTT_DETAIL_PANEL_WIDTH: 0,
    parseUserProfileSnapshot: raw => raw, normalizeGanttCollapseState: () => ({}),
  }
  const saveUserIctProjectPreferences = serviceFunction(service, 'saveUserIctProjectPreferences', storeContext)
  const subscribe = serviceFunction(service, 'subscribeCurrentUserProfileBundle', storeContext)
  const readBundle = () => {
    let bundle
    subscribe('user@example.com', 'ict', value => { bundle = value })()
    return bundle
  }
  assert.equal(readBundle().ictProjectSortBy, undefined)
  const context = {
    user: { email: 'user@example.com' },
    isSavingProjectOrder: false,
    sortedProjects: ['first', 'neighbor', 'restored'].map(id => ({ id })),
    ictProjectOrderIds: profile.ictProjectOrderIds,
    mergeProjectOrder, moveProjectInOrder,
    saveUserIctProjectPreferences,
    setIsSavingProjectOrder() {},
    toast: { error: () => assert.fail('Unexpected error'), success() {} },
  }
  await get('handleMoveProject', context)('restored', { targetProjectId: 'neighbor', position: 'before' }, ['first', 'neighbor', 'restored'])
  const bundle = readBundle()
  assert.deepEqual(Array.from(bundle.projectOrderIds), ['first', 'hidden', 'restored', 'neighbor'])
  assert.equal(bundle.ictProjectSortBy, 'latest')
  const reloaded = get('sortedProjects', {
    projectList: ['first', 'hidden', 'neighbor', 'restored'].map(id => ({ id })),
    ictProjectOrderIds: bundle.projectOrderIds,
    sortBy: bundle.ictProjectSortBy, useMemo: compute => compute(), compareProjectDisplayOrder, applyProjectInsertions,
  })
  assert.deepEqual(Array.from(reloaded, project => project.id), ['first', 'hidden', 'restored', 'neighbor'])
  await saveUserIctProjectPreferences('user@example.com', { sortBy: 'type' })
  assert.deepEqual(Array.from(readBundle().projectOrderIds), Array.from(bundle.projectOrderIds))
  assert.equal(readBundle().ictProjectSortBy, 'type')
  assert.deepEqual(profile.taskAliases, ['Example'])
})

for (const page of ['work-management', 'fa-work-management', 'ict-work-management']) {
  const get = pageFunctions(page)
  test(`${page}: ordinary users cannot change shared visibility or edit projects`, async () => {
    const errors = []
    const context = { canManageProjectVisibility: false, canEdit: false, toast: { error: message => errors.push(message) } }
    await get('handleSetProjectHidden', context)('p', false)
    await get('handleEditProject', context)({ id: 'p', isHidden: false })
    assert.equal(errors.length, 2)
  })
  test(`${page}: authorized visibility change writes only isHidden and records history`, async () => {
    const writes = [], history = []
    const context = {
      canManageProjectVisibility: true, projectList: [{ id: 'p', name: 'Original', isHidden: true }],
      updateProjectInDB: async (...args) => writes.push(args), recordHistory: async entry => history.push(entry),
      serializeProjectData: p => p, toast: { success() {}, error() { assert.fail('Unexpected failure') } },
    }
    await get('handleSetProjectHidden', context)('p', false)
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [['p', { isHidden: false }]])
    assert.equal(history[0].before.isHidden, true)
    assert.equal(history[0].after.isHidden, false)
    await get('handleSetProjectHidden', context)('unavailable', false)
    assert.equal(writes.length, 1)
  })
  test(`${page}: personal selection uses scoped tasks without fetching the whole project`, () => {
    let scope, options, scoped, displayed
    const context = {
      currentUserEmail: 'user@example.com', currentProfileEmail: 'user@example.com',
      canViewFullSchedule: false, isCurrentProfileReady: true, isDepartmentOrgReady: true,
      isScheduleListenerActive: true, scheduleScopeAliases: ['User'],
      setHiddenProjectOptions: value => { options = value }, setScopedHiddenProjects: value => { scoped = value },
      setSelectedHiddenProjectIds() {},
      subscribeProjectsWithTasksByScheduleScope: (value, callback) => {
        scope = value
        callback([{ id: 'visible', tasks: [] }, { id: 'hidden', isHidden: true, tasks: [{ id: 'assigned-task' }] }])
        return () => {}
      },
    }
    get('hiddenSubscription', context)()
    assert.equal(scope.includeAll, undefined)
    assert.equal(scope.includeHidden, true)
    assert.equal(scope.pmEmail, context.currentUserEmail)
    assert.equal(scope.creatorEmail, context.currentUserEmail)
    assert.deepEqual(scope.personKeys, ['User'])
    assert.equal(options.length, 1)
    assert.equal(options[0].tasks.length, 0)
    get('selectedSubscription', {
      ...context, selectedHiddenProjectIds: ['hidden', 'unrelated'], scopedHiddenProjects: scoped,
      selectedHiddenProjectListRef: { current: [] }, visibleProjectListRef: { current: [] },
      mergeProjectLists: (visible, selected) => [...visible, ...selected],
      setProjectList: value => { displayed = value },
      subscribeProjectsWithTasksByProjectIds: () => assert.fail('Unscoped project fetch'),
    })()
    assert.equal(displayed.length, 1)
    assert.equal(displayed[0].tasks[0].id, 'assigned-task')
  })
}
