import { doctor } from "./doctor.mjs";

export async function init(projectPath) {
  const report = await doctor(projectPath);
  const steps = [];

  if (!report.install.installable) {
    // Guide rather than install. This is the honest behaviour while the only
    // published versions are deprecated: an installer that silently fetched
    // them would hand the user a build with known policy-bypass defects.
    steps.push({
      kind: "blocked",
      title: "No supported release is available to install",
      detail: report.install.reason,
      commands: []
    });
  }

  if (report.pair !== null) {
    steps.push({
      kind: "manual",
      title: "Obtain the supported pair from source",
      detail: `Kit ${report.pair.kit.commit} and Hyper ${report.pair.hyper.commit}, which negotiate WorkflowAction ${report.pair.negotiated}.`,
      commands: [
        `git checkout ${report.pair.kit.commit}   # in visp-kit, then: pnpm build`,
        `git checkout ${report.pair.hyper.commit}   # in visp-hyper-agent, then: pnpm build`
      ]
    });
  }

  for (const step of report.recovery) {
    steps.push({ kind: "recovery", title: step, detail: null, commands: [] });
  }

  steps.push({
    kind: "next",
    title: "Once Kit and Hyper are on PATH, initialise the project",
    detail: "Kit owns the workflow; visp-dev does not wrap it.",
    commands: ["visp init .", "visp scan .", "visp next ."]
  });

  return { status: report.status, steps, doctor: report };
}
