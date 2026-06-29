/* ── CodaScope: Zustand Store ─────────────────────────────────────────
   Client-side state management for the CodaScope application.
   Manages projects, wiki topics, chat history, skills, and agent state.
   Navigation/view state is URL-driven (see useAppSubRoute).
   ──────────────────────────────────────────────────────────────────── */

import { create } from "zustand";

// ── Types ───────────────────────────────────────────────────────────

export interface CodaScopeRepo {
  id: string;
  name: string;
  path: string;
  branch?: string;
}

export interface CodaScopeProject {
  id: string;
  name: string;
  description: string;
  repositories: CodaScopeRepo[];
  createdAt: string;
  updatedAt: string;
  wikiPageCount?: number;
  qualityScore?: number;
  conceptCount?: number;
}

export interface WikiTopic {
  id: string;
  title: string;
  path: string;
  type?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  context?: string[];
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  tier: "framework" | "project";
  lockType: "read" | "write";
}


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

  // Chat
  chatMessages: ChatMessage[];

  // Skills
  skills: SkillInfo[];

  // Agent run
  agentRunning: boolean;
  agentStatus: string;
  selectedModel: string;

  // Actions
  setProjectsRoot: (root: string) => void;
  setConfigured: (configured: boolean) => void;
  setProjects: (projects: CodaScopeProject[]) => void;
  setActiveProject: (id: string | null) => void;
  setWikiTopics: (topics: WikiTopic[]) => void;
  setActiveTopic: (id: string | null, content?: string) => void;
  setActiveTopicContent: (content: string) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChat: () => void;
  setSkills: (skills: SkillInfo[]) => void;
  setAgentRunning: (running: boolean) => void;
  setAgentStatus: (status: string) => void;
  setSelectedModel: (model: string) => void;
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
  chatMessages: [],
  skills: [],
  agentRunning: false,
  agentStatus: "",
  selectedModel: (() => {
    try { return localStorage.getItem("codascope:lastModel") ?? ""; }
    catch { return ""; }
  })(),

  // Actions
  setProjectsRoot: (root) => set({ projectsRoot: root }),
  setConfigured: (configured) => set({ configured }),
  setProjects: (projects) => set({ projects }),
  setActiveProject: (id) => set({ activeProjectId: id }),
  setWikiTopics: (topics) => set({ wikiTopics: topics }),
  setActiveTopic: (id, content) => set({ activeTopicId: id, activeTopicContent: content ?? "" }),
  setActiveTopicContent: (content) => set({ activeTopicContent: content }),
  addChatMessage: (message) => set((s) => ({ chatMessages: [...s.chatMessages, message] })),
  clearChat: () => set({ chatMessages: [] }),
  setSkills: (skills) => set({ skills }),
  setAgentRunning: (running) => set({ agentRunning: running }),
  setAgentStatus: (status) => set({ agentStatus: status }),
  setSelectedModel: (model) => {
    try { localStorage.setItem("codascope:lastModel", model); } catch { /* ignore */ }
    set({ selectedModel: model });
  },
}));
