/* ── CodaScope: Zustand Store ─────────────────────────────────────────
   Client-side state management for the CodaScope application.
   Manages projects, wiki topics, skills, and agent state.
   Navigation/view state is URL-driven (see useAppSubRoute).
   ──────────────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { CodaScopeProject, WikiTopic, SkillInfo, EpicDesign } from "./codaScopeTypes";

// Re-export shared types for existing consumers
export type { SkillInfo };



// ── Store ───────────────────────────────────────────────────────────

interface CodaScopeState {
  // Root config
  projectsRoot: string;
  configured: boolean;

  // Projects
  projects: CodaScopeProject[];
  activeProjectId: string | null;

  // Wiki
  wikiTopics: WikiTopic[];
  activeTopicId: string | null;
  activeTopicContent: string;


  // Skills
  skills: SkillInfo[];

  // Agent run
  agentRunning: boolean;
  agentStatus: string;
  selectedModel: string;

  // Epics
  epics: EpicDesign[];

  // Actions
  setProjectsRoot: (root: string) => void;
  setConfigured: (configured: boolean) => void;
  setProjects: (projects: CodaScopeProject[]) => void;
  setActiveProject: (id: string | null) => void;
  setWikiTopics: (topics: WikiTopic[]) => void;
  setActiveTopic: (id: string | null, content?: string) => void;
  setActiveTopicContent: (content: string) => void;

  setSkills: (skills: SkillInfo[]) => void;
  setAgentRunning: (running: boolean) => void;
  setAgentStatus: (status: string) => void;
  setSelectedModel: (model: string) => void;
  setEpics: (epics: EpicDesign[]) => void;
}

export const useCodaScopeStore = create<CodaScopeState>()((set) => ({
  // Initial state
  projectsRoot: "",
  configured: false,
  projects: [],
  activeProjectId: null,
  wikiTopics: [],
  activeTopicId: null,
  activeTopicContent: "",

  skills: [],
  agentRunning: false,
  agentStatus: "",
  selectedModel: (() => {
    try { return localStorage.getItem("codascope:lastModel") ?? ""; }
    catch { return ""; }
  })(),
  epics: [],

  // Actions
  setProjectsRoot: (root) => set({ projectsRoot: root }),
  setConfigured: (configured) => set({ configured }),
  setProjects: (projects) => set({ projects }),
  setActiveProject: (id) => set({ activeProjectId: id }),
  setWikiTopics: (topics) => set({ wikiTopics: topics }),
  setActiveTopic: (id, content) => set({ activeTopicId: id, activeTopicContent: content ?? "" }),
  setActiveTopicContent: (content) => set({ activeTopicContent: content }),

  setSkills: (skills) => set({ skills }),
  setAgentRunning: (running) => set({ agentRunning: running }),
  setAgentStatus: (status) => set({ agentStatus: status }),
  setSelectedModel: (model) => {
    try { localStorage.setItem("codascope:lastModel", model); } catch { /* ignore */ }
    set({ selectedModel: model });
  },
  setEpics: (epics) => set({ epics }),
}));
