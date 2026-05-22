import { create } from 'zustand';
import type {
  AgentRoom,
  AgentRoomArtifact,
  AgentRoomMessage,
  AgentRoomRun,
  AgentRoomSnapshot,
  AgentRoomTask,
} from '../types';

interface AgentRoomState {
  rooms: AgentRoom[];
  runsByRoom: Record<string, AgentRoomRun[]>;
  messagesByRoom: Record<string, AgentRoomMessage[]>;
  artifactsByRoom: Record<string, AgentRoomArtifact[]>;
  tasksByRoom: Record<string, AgentRoomTask[]>;
  activeRoomId: string | null;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setSnapshot: (snapshot: AgentRoomSnapshot) => void;
  setActiveRoom: (roomId: string | null) => void;
  upsertRoom: (room: AgentRoom) => void;
  removeRoom: (roomId: string) => void;
  upsertRun: (run: AgentRoomRun) => void;
  addMessage: (message: AgentRoomMessage) => void;
  addArtifact: (artifact: AgentRoomArtifact) => void;
  upsertTask: (task: AgentRoomTask) => void;
}

export const useAgentRoomStore = create<AgentRoomState>((set) => ({
  rooms: [],
  runsByRoom: {},
  messagesByRoom: {},
  artifactsByRoom: {},
  tasksByRoom: {},
  activeRoomId: null,
  loading: false,

  setLoading: (loading) => set({ loading }),

  setSnapshot: (snapshot) =>
    set((state) => ({
      rooms: sortRooms(snapshot.rooms),
      runsByRoom: sortRunsByRoom(snapshot.runsByRoom),
      messagesByRoom: sortMessagesByRoom(snapshot.messagesByRoom),
      artifactsByRoom: sortArtifactsByRoom(snapshot.artifactsByRoom),
      tasksByRoom: snapshot.tasksByRoom,
      activeRoomId: state.activeRoomId && snapshot.rooms.some((room) => room.id === state.activeRoomId)
        ? state.activeRoomId
        : snapshot.rooms[0]?.id ?? null,
    })),

  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

  upsertRoom: (room) =>
    set((state) => ({
      rooms: sortRooms(upsert(state.rooms, room)),
      activeRoomId: state.activeRoomId ?? room.id,
    })),

  removeRoom: (roomId) =>
    set((state) => {
      const rooms = state.rooms.filter((room) => room.id !== roomId);
      const runsByRoom = { ...state.runsByRoom };
      const messagesByRoom = { ...state.messagesByRoom };
      const artifactsByRoom = { ...state.artifactsByRoom };
      const tasksByRoom = { ...state.tasksByRoom };
      delete runsByRoom[roomId];
      delete messagesByRoom[roomId];
      delete artifactsByRoom[roomId];
      delete tasksByRoom[roomId];
      return {
        rooms,
        runsByRoom,
        messagesByRoom,
        artifactsByRoom,
        tasksByRoom,
        activeRoomId: state.activeRoomId === roomId ? rooms[0]?.id ?? null : state.activeRoomId,
      };
    }),

  upsertRun: (run) =>
    set((state) => ({
      runsByRoom: {
        ...state.runsByRoom,
        [run.roomId]: sortRuns(upsert(state.runsByRoom[run.roomId] ?? [], run)),
      },
    })),

  addMessage: (message) =>
    set((state) => ({
      messagesByRoom: {
        ...state.messagesByRoom,
        [message.roomId]: sortMessages(upsert(state.messagesByRoom[message.roomId] ?? [], message)),
      },
    })),

  addArtifact: (artifact) =>
    set((state) => ({
      artifactsByRoom: {
        ...state.artifactsByRoom,
        [artifact.roomId]: sortArtifacts(upsert(state.artifactsByRoom[artifact.roomId] ?? [], artifact)),
      },
    })),

  upsertTask: (task) =>
    set((state) => ({
      tasksByRoom: {
        ...state.tasksByRoom,
        [task.roomId]: upsert(state.tasksByRoom[task.roomId] ?? [], task),
      },
    })),
}));

export function getActiveAgentRoom() {
  const state = useAgentRoomStore.getState();
  const roomId = state.activeRoomId ?? state.rooms[0]?.id;
  if (!roomId) return null;
  return {
    room: state.rooms.find((room) => room.id === roomId) ?? null,
    runs: state.runsByRoom[roomId] ?? [],
    messages: state.messagesByRoom[roomId] ?? [],
    artifacts: state.artifactsByRoom[roomId] ?? [],
    tasks: state.tasksByRoom[roomId] ?? [],
  };
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [item, ...items];
}

function sortRooms(rooms: AgentRoom[]): AgentRoom[] {
  return [...rooms].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sortRuns(runs: AgentRoomRun[]): AgentRoomRun[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt);
}

function sortRunsByRoom(input: Record<string, AgentRoomRun[]>): Record<string, AgentRoomRun[]> {
  return Object.fromEntries(Object.entries(input).map(([roomId, runs]) => [roomId, sortRuns(runs)]));
}

function sortMessages(messages: AgentRoomMessage[]): AgentRoomMessage[] {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp);
}

function sortMessagesByRoom(input: Record<string, AgentRoomMessage[]>): Record<string, AgentRoomMessage[]> {
  return Object.fromEntries(Object.entries(input).map(([roomId, messages]) => [roomId, sortMessages(messages)]));
}

function sortArtifacts(artifacts: AgentRoomArtifact[]): AgentRoomArtifact[] {
  return [...artifacts].sort((a, b) => b.createdAt - a.createdAt);
}

function sortArtifactsByRoom(input: Record<string, AgentRoomArtifact[]>): Record<string, AgentRoomArtifact[]> {
  return Object.fromEntries(Object.entries(input).map(([roomId, artifacts]) => [roomId, sortArtifacts(artifacts)]));
}
