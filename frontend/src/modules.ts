import type { LucideIcon } from "lucide-react";
import { Home, Layers, BookOpen } from "lucide-react";

export type Module = "inicio" | "procesos" | "conocimiento";

export type ModuleMeta = {
  id: Module;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  requiresRole?: "admin" | "architect" | "analyst";
  comingSoon?: { chat: number };
};

export const MODULES: ModuleMeta[] = [
  {
    id: "inicio",
    label: "Inicio",
    description: "Contexto organizacional: misión, visión, valores, estrategia, KPIs y POA",
    icon: Home,
    accent: "var(--teal)",
  },
  {
    id: "procesos",
    label: "Procesos",
    description: "Mapa de procesos y BPMN (AS-IS / TO-BE)",
    icon: Layers,
    accent: "var(--teal)",
  },
  {
    id: "conocimiento",
    label: "Conocimiento",
    description: "Mapa de conocimiento de los nodos",
    icon: BookOpen,
    accent: "var(--amber)",
  },
];

export function moduleById(id: Module): ModuleMeta {
  return MODULES.find((m) => m.id === id) ?? MODULES[0];
}
