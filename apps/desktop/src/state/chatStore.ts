import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

type ChatMessageInput = Omit<ChatMessage, 'id'> & { id?: string };

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  category: string;
  score: number;
  expectedProfit: string;
  timeframe: string;
  source: string;
  url?: string;
  createdAt: number;
}

interface ChatState {
  messages: ChatMessage[];
  opportunities: Opportunity[];
  isLoading: boolean;
  addMessage: (msg: ChatMessageInput) => void;
  addOpportunity: (opp: Opportunity) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      opportunities: [],
      isLoading: false,

      addMessage: (msg) =>
        set((state) => ({
          messages: [...state.messages, { ...msg, id: msg.id || crypto.randomUUID(), timestamp: Date.now() }].slice(-200),
        })),

      addOpportunity: (opp) =>
        set((state) => {
          if (state.opportunities.some((o) => o.id === opp.id)) return state;
          return { opportunities: [opp, ...state.opportunities].slice(0, 20) };
        }),

      setLoading: (loading) => set({ isLoading: loading }),

      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: 'cakal-chat-store',
      partialize: (state) => ({
        messages: state.messages,
        opportunities: state.opportunities,
      }),
    },
  ),
);
