/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for minimal Docker images
  output: 'standalone',
  // Custom port
  env: {
    PORT: '6969',
  },
  // Baileys is added as an external because it has optional image-processing
  // deps (jimp, sharp) that are imported via `import('...').catch(() => {})`
  // at runtime. Turbopack's static module resolution flags these as missing
  // at build time even though Baileys handles their absence gracefully. We
  // only send text, so those deps are never reached. Treating Baileys as
  // an external also keeps puppeteer/baileys out of the client bundle.
  serverExternalPackages: ['puppeteer', 'israeli-bank-scrapers', 'bufferutil', 'utf-8-validate', '@whiskeysockets/baileys', 'jimp', 'sharp'],
};

export default nextConfig;
