export function test(name: string, run: () => void): void {
  run();
  console.log(`✓ ${name}`);
}
