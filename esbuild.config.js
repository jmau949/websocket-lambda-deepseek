const { build } = require("esbuild");
const { readdirSync, mkdirSync, copyFileSync, existsSync } = require("fs");
const { join, dirname } = require("path");

const handlersDir = join(__dirname, "src", "handlers");
const entryPoints = readdirSync(handlersDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => join(handlersDir, file));

// Function to copy proto files
function copyProtoFiles() {
  const sourceProtoDir = join(__dirname, "src", "proto");
  const targetProtoDir = join(__dirname, "dist", "proto");

  // Create target directory if it doesn't exist
  if (!existsSync(targetProtoDir)) {
    mkdirSync(targetProtoDir, { recursive: true });
  }

  // Copy all files from source to target
  const protoFiles = readdirSync(sourceProtoDir);
  for (const file of protoFiles) {
    const sourcePath = join(sourceProtoDir, file);
    const targetPath = join(targetProtoDir, file);
    copyFileSync(sourcePath, targetPath);
    console.log(`Copied proto file: ${file}`);
  }
}

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
})
  .then(() => {
    // Copy proto files after successful build
    copyProtoFiles();
    console.log("Build completed successfully, proto files copied.");
  })
  .catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
