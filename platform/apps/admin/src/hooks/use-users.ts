"use client";

import * as React from "react";
import { useConvex } from "convex/react";
import { fetchUsers, type AdminUser, type FetchUsersParams } from "@/lib/admin-api";

const PAGE_SIZE = 50;
export type OperatorFilters = Pick<FetchUsersParams, "searchValue" | "status" | "sortBy" | "sortDirection">;
type SearchStream = { searchField: "name" | "email"; cursor: string | null; done: boolean };

export function useUsers(filters: OperatorFilters) {
  const client = useConvex();
  const { searchValue, status, sortDirection = "desc" } = filters;
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  const state = React.useRef<{ streams: SearchStream[]; users: AdminUser[]; pending: boolean }>({ streams: [], users: [], pending: false });

  const fetchPage = React.useCallback(async (requestGeneration: number, append: boolean) => {
    if (state.current.pending) return;
    state.current.pending = true;
    const pendingStreams = state.current.streams.filter(stream => !stream.done);
    try {
      const results = await Promise.all(pendingStreams.map(stream => fetchUsers(client, {
        limit: PAGE_SIZE, cursor: stream.cursor, searchField: stream.searchField,
        searchValue, status, sortBy: "createdAt", sortDirection,
      })));
      if (requestGeneration !== generation.current) return;
      const merged = new Map((append ? state.current.users : []).map(user => [user.id, user]));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result.isDone && (!result.continueCursor || result.continueCursor === pendingStreams[i].cursor)) {
          throw new Error("INVALID_OPERATOR_CURSOR");
        }
      }
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        pendingStreams[i].cursor = result.continueCursor;
        pendingStreams[i].done = result.isDone;
        for (const user of result.users) merged.set(user.id, user);
      }
      const direction = sortDirection === "asc" ? 1 : -1;
      const nextUsers = [...merged.values()].sort((a, b) =>
        direction * (a.createdAt.getTime() - b.createdAt.getTime()) || a.id.localeCompare(b.id));
      state.current.users = nextUsers;
      setUsers(nextUsers);
      setHasMore(state.current.streams.some(stream => !stream.done));
      setError(null);
    } catch {
      if (requestGeneration === generation.current) setError("Could not load operators. Try again.");
    } finally {
      if (requestGeneration === generation.current) {
        state.current.pending = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [client, searchValue, status, sortDirection]);

  const refresh = React.useCallback(() => {
    const requestGeneration = ++generation.current;
    state.current = { users: [], pending: false, streams: searchValue
      ? [{ searchField: "name", cursor: null, done: false }, { searchField: "email", cursor: null, done: false }]
      : [{ searchField: "name", cursor: null, done: false }] };
    setUsers([]);
    setHasMore(false);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    void fetchPage(requestGeneration, false);
  }, [searchValue, fetchPage]);

  React.useEffect(() => {
    const requests = generation;
    refresh();
    return () => { requests.current++; };
  }, [refresh]);

  const loadMore = React.useCallback(() => {
    if (state.current.pending || state.current.streams.every(stream => stream.done)) return;
    setLoadingMore(true);
    void fetchPage(generation.current, true);
  }, [fetchPage]);

  return { users, total: users.length, loading, loadingMore, hasMore, loadMore, refresh, error };
}
