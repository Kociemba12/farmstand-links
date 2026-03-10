/**
 * FarmstandDebugOverlay
 *
 * A temporary debug panel for diagnosing the My Farmstand load and delete flow.
 * ONLY shown in __DEV__ mode (Expo Go / dev builds / TestFlight dev builds).
 *
 * To remove: delete this file and remove all <FarmstandDebugOverlay ... /> usages.
 */

import React, { useRef, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';

export interface FarmstandDebugState {
  // Auth
  authReady: boolean;
  userId: string | null;

  // Profile
  profileLoaded: boolean;
  profileScreenMounted: boolean;

  // Farmstand query (bootstrap store)
  farmstandQueryIsLoading: boolean;
  farmstandQueryIsFetching: boolean;
  farmstandQueryStatus: string;
  farmstandQueryReturnedId: string | null;
  farmstandQueryReturnedNull: boolean;
  farmstandQueryError: string | null;

  // Manager screen
  managerScreenMounted: boolean;
  currentFarmstandId: string | null;
  currentFarmstandName: string | null;

  // Delete flow
  deleteStarted: boolean;
  deleteFinished: boolean;
  deleteSuccess: boolean | null;
  deleteError: string | null;
  localFarmstandStateCleared: boolean;
  navigationToProfileFired: boolean;
}

export const FARMSTAND_DEBUG_INITIAL: FarmstandDebugState = {
  authReady: false,
  userId: null,
  profileLoaded: false,
  profileScreenMounted: false,
  farmstandQueryIsLoading: false,
  farmstandQueryIsFetching: false,
  farmstandQueryStatus: 'idle',
  farmstandQueryReturnedId: null,
  farmstandQueryReturnedNull: false,
  farmstandQueryError: null,
  managerScreenMounted: false,
  currentFarmstandId: null,
  currentFarmstandName: null,
  deleteStarted: false,
  deleteFinished: false,
  deleteSuccess: null,
  deleteError: null,
  localFarmstandStateCleared: false,
  navigationToProfileFired: false,
};

interface Props {
  state: FarmstandDebugState;
  /** Extra key=value pairs you want to show. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

type Highlight = 'good' | 'bad' | 'warn' | 'info' | undefined;

function Row({ label, value, highlight }: { label: string; value: string; highlight?: Highlight }) {
  const textColor =
    highlight === 'good'
      ? '#16a34a'
      : highlight === 'bad'
      ? '#dc2626'
      : highlight === 'warn'
      ? '#d97706'
      : highlight === 'info'
      ? '#2563eb'
      : '#f3f4f6';

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Text style={{ color: '#9ca3af', fontSize: 10, flex: 1 }}>{label}</Text>
      <Text
        style={{ color: textColor, fontSize: 10, fontWeight: '600', maxWidth: 140, textAlign: 'right' }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Text
      style={{
        color: '#6b7280',
        fontSize: 9,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 6,
        marginBottom: 2,
      }}
    >
      {title}
    </Text>
  );
}

function boolHighlight(v: boolean | null | undefined): Highlight {
  if (v === null || v === undefined) return 'warn';
  return v ? 'good' : 'bad';
}

function boolStr(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  return v ? 'true' : 'false';
}

export function FarmstandDebugOverlay({ state, extra }: Props) {
  // Hooks must always be called — guard the render output instead
  const [collapsed, setCollapsed] = useState(false);
  const [lastChanged, setLastChanged] = useState(() => new Date().toISOString().slice(11, 23));
  const prevStateRef = useRef(JSON.stringify(state));

  useEffect(() => {
    const next = JSON.stringify(state);
    if (next !== prevStateRef.current) {
      prevStateRef.current = next;
      setLastChanged(new Date().toISOString().slice(11, 23));
    }
  }, [state]);

  if (!__DEV__) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 90,
        right: 8,
        width: collapsed ? 56 : 240,
        maxHeight: collapsed ? 32 : 440,
        backgroundColor: 'rgba(17,24,39,0.93)',
        borderRadius: 10,
        zIndex: 9999,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#374151',
      }}
    >
      {/* Header / toggle */}
      <Pressable
        onPress={() => setCollapsed((c) => !c)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 8,
          paddingVertical: 5,
          backgroundColor: 'rgba(55,65,81,0.8)',
        }}
      >
        <Text style={{ color: '#fbbf24', fontSize: 10, fontWeight: '700' }}>
          {collapsed ? 'DBG' : 'FARMSTAND DEBUG'}
        </Text>
        {!collapsed && <Text style={{ color: '#9ca3af', fontSize: 10 }}>tap</Text>}
      </Pressable>

      {!collapsed && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}
        >
          {/* ── Auth ── */}
          <Section title="Auth" />
          <Row label="authReady" value={boolStr(state.authReady)} highlight={boolHighlight(state.authReady)} />
          <Row
            label="user.id"
            value={state.userId ? state.userId.slice(0, 14) + '\u2026' : 'null'}
            highlight={state.userId ? 'good' : 'bad'}
          />

          {/* ── Profile Screen ── */}
          <Section title="Profile Screen" />
          <Row label="profileMounted" value={boolStr(state.profileScreenMounted)} highlight={boolHighlight(state.profileScreenMounted)} />
          <Row label="profileLoaded" value={boolStr(state.profileLoaded)} highlight={boolHighlight(state.profileLoaded)} />

          {/* ── Bootstrap / Farmstand Query ── */}
          <Section title="Farmstand Query" />
          <Row label="isLoading" value={boolStr(state.farmstandQueryIsLoading)} highlight={state.farmstandQueryIsLoading ? 'warn' : undefined} />
          <Row label="isFetching" value={boolStr(state.farmstandQueryIsFetching)} highlight={state.farmstandQueryIsFetching ? 'info' : undefined} />
          <Row
            label="status"
            value={state.farmstandQueryStatus}
            highlight={
              state.farmstandQueryStatus === 'loaded'
                ? 'good'
                : state.farmstandQueryStatus === 'error'
                ? 'bad'
                : 'warn'
            }
          />
          <Row
            label="returnedId"
            value={state.farmstandQueryReturnedId ? state.farmstandQueryReturnedId.slice(0, 14) + '\u2026' : 'null'}
            highlight={state.farmstandQueryReturnedId ? 'good' : undefined}
          />
          <Row
            label="returnedNull"
            value={boolStr(state.farmstandQueryReturnedNull)}
            highlight={state.farmstandQueryReturnedNull ? 'warn' : undefined}
          />
          {state.farmstandQueryError != null && (
            <Row label="queryError" value={state.farmstandQueryError.slice(0, 28)} highlight="bad" />
          )}

          {/* ── Manager Screen ── */}
          <Section title="Manager Screen" />
          <Row label="managerMounted" value={boolStr(state.managerScreenMounted)} highlight={boolHighlight(state.managerScreenMounted)} />
          <Row
            label="currentId"
            value={state.currentFarmstandId ? state.currentFarmstandId.slice(0, 14) + '\u2026' : 'null'}
            highlight={state.currentFarmstandId ? 'good' : undefined}
          />
          <Row
            label="currentName"
            value={state.currentFarmstandName ?? 'null'}
            highlight={state.currentFarmstandName ? 'good' : undefined}
          />

          {/* ── Delete Flow ── */}
          <Section title="Delete Flow" />
          <Row label="deleteStarted" value={boolStr(state.deleteStarted)} highlight={state.deleteStarted ? 'info' : undefined} />
          <Row label="deleteFinished" value={boolStr(state.deleteFinished)} highlight={state.deleteFinished ? 'good' : undefined} />
          <Row
            label="deleteSuccess"
            value={state.deleteSuccess === null ? 'null' : boolStr(state.deleteSuccess)}
            highlight={state.deleteSuccess === true ? 'good' : state.deleteSuccess === false ? 'bad' : undefined}
          />
          {state.deleteError != null && (
            <Row label="deleteError" value={state.deleteError.slice(0, 28)} highlight="bad" />
          )}
          <Row label="localCleared" value={boolStr(state.localFarmstandStateCleared)} highlight={boolHighlight(state.localFarmstandStateCleared)} />
          <Row label="navFired" value={boolStr(state.navigationToProfileFired)} highlight={boolHighlight(state.navigationToProfileFired)} />

          {/* ── Extra ── */}
          {extra != null && Object.keys(extra).length > 0 && (
            <>
              <Section title="Extra" />
              {Object.entries(extra).map(([k, v]) => (
                <Row key={k} label={k} value={String(v ?? 'null')} />
              ))}
            </>
          )}

          {/* ── Timestamp ── */}
          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 4 }}>
            <Text style={{ color: '#6b7280', fontSize: 9 }}>last change: {lastChanged}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
