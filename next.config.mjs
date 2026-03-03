/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // 정적 내보내기 활성화
  images: {
    unoptimized: true, // GitHub Pages는 Next.js 이미지 최적화 서버를 지원하지 않음
  },
  // 만약 저장소 이름이 'work-manager'라면 아래 주석을 해제하고 설정하세요.
  // basePath: process.env.NODE_ENV === 'production' ? '/work-manager' : '',
  // assetPrefix: process.env.NODE_ENV === 'production' ? '/work-manager/' : '',
};

export default nextConfig;
