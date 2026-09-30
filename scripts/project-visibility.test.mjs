import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function pageFunctions(page) {
  const source = ts.createSourceFile(page, readFileSync(new URL(`../app/${page}/page.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes = {}
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['handleSetProjectHidden', 'handleEditProject'].includes(node.name.getText(source))) {
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
