import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/lambda.ts'],
    bundle: true,          // inline all imports into one file
    platform: 'node',
    target: 'node20',
    format: 'cjs',         // Lambda requires CommonJS
    outfile: 'dist/index.js',
    // Bundle the AWS SDK too — don't rely on Lambda's bundled version
    // which may not match the modular v3 packages you're using
});

console.log('Build complete → dist/index.js');