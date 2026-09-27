"""StateGraph wiring (PRD §7 flow).

ideate -> script -> tts -> gen_shots =(Send x N)=> gen_shot -> collect_shots -> music -> render -> qa
      -> approve ⏸ -> metadata -> publish -> finalize
approve may also route back to any regeneratable stage (regenerate) or to tts (edit), or end (reject).
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .nodes import Deps, build_nodes
from .state import RunState


def build_graph(deps: Deps, checkpointer=None):
    n = build_nodes(deps)
    g = StateGraph(RunState)
    g.add_node("ideate", n["ideate"])
    g.add_node("script", n["script"])
    g.add_node("tts", n["tts"])
    g.add_node("gen_shots", n["gen_shots"], destinations=("gen_shot", "collect_shots"))
    g.add_node("gen_shot", n["gen_shot"])
    g.add_node("collect_shots", n["collect_shots"])
    g.add_node("music", n["music"])
    g.add_node("render", n["render"])
    g.add_node("qa", n["qa"])
    g.add_node("approve", n["approve"],
               destinations=("metadata", "finalize", "ideate", "script", "tts", "gen_shots", "music", "render"))
    g.add_node("metadata", n["metadata"])
    g.add_node("publish", n["publish"])
    g.add_node("finalize", n["finalize"])

    g.add_edge(START, "ideate")
    g.add_edge("ideate", "script")
    g.add_edge("script", "tts")
    g.add_edge("tts", "gen_shots")
    g.add_edge("gen_shot", "collect_shots")
    g.add_edge("collect_shots", "music")
    g.add_edge("music", "render")
    g.add_edge("render", "qa")
    g.add_edge("qa", "approve")
    g.add_edge("metadata", "publish")
    g.add_edge("publish", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
