import { defineConfig, type Plugin } from 'vite';

function commitInjectPlugin(): Plugin {
  return {
    name: 'commit-inject',
    transformIndexHtml(html) {
      const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
      let buildHtml: string;
      if (sha && /^[0-9a-f]{7,40}$/i.test(sha)) {
        const short = sha.slice(0, 7);
        buildHtml = `build <a href="https://github.com/qzvx/resource-pack-updater/commit/${sha}" target="_blank" rel="noopener noreferrer">${short}</a>`;
      } else {
        buildHtml = 'dev';
      }
      return html.replace('<!-- BUILD_INFO -->', buildHtml);
    },
  };
}

export default defineConfig({
  plugins: [commitInjectPlugin()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
