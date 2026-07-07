import { SkillDefinition } from "../schemas/skill.js";
import { isWellStructured } from "../schemas/concept.js";

export interface GraphValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Personal skill graph: a dependency DAG of typed nodes (Phase 1).
 * Structural rules enforced:
 *  - acyclic
 *  - all prerequisite / component references resolve
 *  - ill_structured_composite nodes are decomposed into well-structured
 *    components (decomposition duty, D4)
 *  - classic-type nodes carry no component list
 */
export class SkillGraph {
  private nodes = new Map<string, SkillDefinition>();

  add(skill: SkillDefinition): void {
    this.nodes.set(skill.skill_id, SkillDefinition.parse(skill));
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.nodes.get(skillId);
  }

  all(): SkillDefinition[] {
    return [...this.nodes.values()];
  }

  validate(): GraphValidation {
    const errors: string[] = [];

    for (const node of this.nodes.values()) {
      for (const p of node.prerequisites) {
        if (!this.nodes.has(p)) errors.push(`${node.skill_id}: unresolved prerequisite '${p}'`);
      }
      for (const c of node.component_skill_ids) {
        if (!this.nodes.has(c)) errors.push(`${node.skill_id}: unresolved component '${c}'`);
      }
      if (node.concept_type === "ill_structured_composite") {
        if (node.component_skill_ids.length === 0) {
          errors.push(
            `${node.skill_id}: ill_structured_composite must be decomposed into well-structured components`
          );
        }
        for (const c of node.component_skill_ids) {
          const comp = this.nodes.get(c);
          if (comp && !isWellStructured(comp.concept_type)) {
            errors.push(
              `${node.skill_id}: component '${c}' is itself ill_structured_composite — components must be classic types`
            );
          }
        }
      } else if (node.component_skill_ids.length > 0) {
        errors.push(`${node.skill_id}: only ill_structured_composite nodes carry components`);
      }
    }

    const cycle = this.findCycle();
    if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);

    return { valid: errors.length === 0, errors };
  }

  /** Prerequisite trace for diagnostic nudges (advisory, never blocking — D5). */
  prerequisiteClosure(skillId: string): string[] {
    const seen = new Set<string>();
    const stack = [...(this.nodes.get(skillId)?.prerequisites ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(this.nodes.get(id)?.prerequisites ?? []));
    }
    return [...seen];
  }

  private findCycle(): string[] | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string>();
    for (const id of this.nodes.keys()) color.set(id, WHITE);

    const edges = (id: string) => {
      const n = this.nodes.get(id);
      return n ? [...n.prerequisites, ...n.component_skill_ids].filter((e) => this.nodes.has(e)) : [];
    };

    for (const start of this.nodes.keys()) {
      if (color.get(start) !== WHITE) continue;
      const stack: Array<{ id: string; iter: string[] }> = [{ id: start, iter: edges(start) }];
      color.set(start, GRAY);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const next = top.iter.shift();
        if (next === undefined) {
          color.set(top.id, BLACK);
          stack.pop();
          continue;
        }
        if (color.get(next) === GRAY) {
          // reconstruct cycle
          const cycle = [next];
          let cur = top.id;
          while (cur !== next) {
            cycle.push(cur);
            cur = parent.get(cur)!;
          }
          cycle.push(next);
          return cycle.reverse();
        }
        if (color.get(next) === WHITE) {
          color.set(next, GRAY);
          parent.set(next, top.id);
          stack.push({ id: next, iter: edges(next) });
        }
      }
    }
    return null;
  }
}
