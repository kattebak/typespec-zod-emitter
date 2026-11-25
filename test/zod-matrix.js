import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const [output = "../build/zod-schemas", fixture = "test/example.js"] =
	process.argv.slice(2);
const packageDir = fileURLToPath(new URL(output, import.meta.url));
const zodLink = `${packageDir}/node_modules/zod`;

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

for (const alias of ["zod3", "zod4"]) {
	console.log(`# emitted package against ${alias}`);
	rmSync(`${packageDir}/node_modules`, { recursive: true, force: true });
	mkdirSync(`${packageDir}/node_modules`);
	symlinkSync(`${root}/node_modules/${alias}`, zodLink, "dir");
	run("npx", ["tsc", "-p", packageDir]);
	run("node", ["--test", "--test-timeout=60000", fixture]);
}
