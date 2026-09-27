import type { Project } from "@flossamer/core";
import { updateProject } from "@/lib/actions";
import { loadStudio, lookups } from "@/lib/data";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const field = "mt-1 w-full rounded-md border border-rule bg-paper px-2 py-1.5";

function ProjectCard({ project, stages, people }: { project: Project; stages: string[]; people: string }) {
  return (
    <li className="rounded-lg border border-rule bg-surface p-3 text-sm">
      <p className="font-medium">{project.title}</p>
      {people && <p className="text-muted">{people}</p>}
      {project.paidAmount !== null ? (
        <p className="mt-2">Paid {money(project.paidAmount)}</p>
      ) : project.estimatedValue !== null ? (
        <p className="mt-2 text-muted">About {money(project.estimatedValue)}</p>
      ) : null}
      {project.nextStep && <p className="mt-1 text-muted">Next: {project.nextStep}</p>}

      <details className="mt-2">
        <summary className="cursor-pointer select-none text-muted">Edit</summary>
        <form action={updateProject.bind(null, project.id)} className="mt-2 space-y-2">
          <label className="block">
            Title
            <input name="title" defaultValue={project.title} className={field} />
          </label>
          <label className="block">
            Stage
            <select name="stage" defaultValue={project.stage} className={field}>
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Estimated value ($)
            <input name="estimated_value" inputMode="numeric" defaultValue={project.estimatedValue ?? ""} className={field} />
          </label>
          <label className="block">
            Next step
            <input name="next_step" defaultValue={project.nextStep ?? ""} className={field} />
          </label>
          <label className="block">
            Paid amount ($)
            <input name="paid_amount" inputMode="numeric" defaultValue={project.paidAmount ?? ""} className={field} />
          </label>
          <button className="rounded-md bg-ink px-3 py-1.5 text-paper">Save</button>
        </form>
      </details>
    </li>
  );
}

export default async function Work() {
  const data = await loadStudio();
  const find = lookups(data);
  const stages = data.studio.stages;
  const orphans = data.projects.filter((p) => !stages.includes(p.stage));

  return (
    <>
      <h1 className="font-serif text-4xl tracking-tight">Work</h1>
      <p className="mt-2 text-muted">
        Potential and active projects. Add one from an inquiry with &ldquo;Add to Work&rdquo;, and mark it paid when the money arrives.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-5">
        {stages.map((stage, n) => (
          <section key={stage} aria-label={stage}>
            <h2 className="border-b border-rule pb-2 text-sm font-medium">{stage}</h2>
            <ul className="mt-3 space-y-3">
              {[...data.projects.filter((p) => p.stage === stage), ...(n === 0 ? orphans : [])].map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  stages={stages}
                  people={p.personIds.map((id) => find.person(id)?.name).filter(Boolean).join(", ")}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
