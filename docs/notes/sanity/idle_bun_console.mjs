// Bun-native idle sandbox: answers 1 + 1, then waits for stdin to close using Bun's console reader.
console.log(1 + 1);
for await (const _line of console) {
}
