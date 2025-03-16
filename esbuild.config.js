const { build } = require("esbuild");
const { readdirSync } = require("fs");
const { join } = require("path");

const handlersDir = join(__dirname, "src", "handlers");
const entryPoints = readdirSync(handlersDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => join(handlersDir, file));

// Build handlers
build({
  entryPoints,
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: "node",
  target: "node18",
  outdir: "dist/handlers",
  format: "cjs",
  // Don't use outExtension as it's causing an error
  // Instead, we'll use standard .js extensions
  external: [
    "aws-sdk", // Exclude AWS SDK (available in AWS Lambda runtime)
    "@aws-sdk/*", // Exclude AWS SDK v3 modules
    "@sentry/node", // Exclude Sentry (provided by Lambda layer)
  ],
}).catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
