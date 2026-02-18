import { $ } from 'bun';

const isCompile = process.argv.includes('--compile');

if (isCompile) {
  await $`bun build src/cli.ts --compile --outfile ./vigil --external @anthropic-ai/claude-agent-sdk --external react-devtools-core`;
} else {
  await $`bun build src/cli.ts --outdir dist --target bun --external @anthropic-ai/claude-agent-sdk --external react-devtools-core`;
}
