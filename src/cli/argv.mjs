/**
 * The command line, parsed. Unknown arguments are an error rather than a
 * silent ignore: an ignored flag is a user believing they asked for something.
 */
import process from "node:process";

export const USAGE = `visp-dev — setup, diagnostics, and compatibility for Visp

Usage:
  visp-dev doctor   [--project <path>] [--json]
  visp-dev init     [--project <path>] [--json]
  visp-dev versions [--project <path>] [--json]
  visp-dev --version

visp-dev reports state and tells you the exact next command. It decides no
gate and computes no evidence; Visp Kit owns all of that.
`;

export function parse(argv) {
  const [command, ...rest] = argv;
  let projectPath = process.cwd();
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--json") json = true;
    else if (rest[index] === "--project") {
      projectPath = rest[index + 1];
      index += 1;
      if (projectPath === undefined) throw new TypeError("--project requires a path");
    } else throw new TypeError(`Unknown argument: ${rest[index]}`);
  }

  return { command, projectPath, json };
}
