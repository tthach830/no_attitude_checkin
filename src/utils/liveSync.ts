import type { TeamEntry } from '../types';

const DEFAULT_SYNC_TOPIC = 'no_attitude_volleyball_checkin_live_2026_v1';
const NTFY_BASE_URL = 'https://ntfy.sh';

export interface LiveSyncPayload {
  type: 'full_state' | 'team_update';
  senderId: string;
  timestamp: number;
  tournamentName: string;
  totalCourtsAvailable: number;
  teams?: TeamEntry[];
  updatedTeam?: TeamEntry;
}

interface NtfyEnvelope {
  id: string;
  time: number;
  event: string;
  message?: string;
  attachment?: {
    url: string;
  };
}

export function getClientSenderId(): string {
  const key = 'no_attitude_sender_id_v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `client-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
    try {
      localStorage.setItem(key, id);
    } catch {
      // ignore
    }
  }
  return id;
}

export async function publishLiveSync(
  payload: LiveSyncPayload,
  topic: string = DEFAULT_SYNC_TOPIC
): Promise<boolean> {
  try {
    const res = await fetch(`${NTFY_BASE_URL}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function extractPayloadFromEnvelope(env: NtfyEnvelope): Promise<LiveSyncPayload | null> {
  try {
    if (env.event !== 'message') return null;
    if (env.attachment?.url) {
      const res = await fetch(env.attachment.url);
      if (!res.ok) return null;
      const data = (await res.json()) as LiveSyncPayload;
      return data && data.type ? data : null;
    }
    if (env.message) {
      const data = JSON.parse(env.message) as LiveSyncPayload;
      return data && data.type ? data : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchLatestLiveState(
  topic: string = DEFAULT_SYNC_TOPIC
): Promise<{
  tournamentName: string;
  totalCourtsAvailable: number;
  teams: TeamEntry[];
  timestamp: number;
} | null> {
  try {
    const res = await fetch(
      `${NTFY_BASE_URL}/${encodeURIComponent(topic)}/json?poll=1&since=24h`
    );
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return null;

    let latestFullState: {
      tournamentName: string;
      totalCourtsAvailable: number;
      teams: TeamEntry[];
      timestamp: number;
    } | null = null;

    const subsequentTeamUpdates: { timestamp: number; team: TeamEntry }[] = [];

    for (const line of lines) {
      try {
        const env = JSON.parse(line) as NtfyEnvelope;
        const payload = await extractPayloadFromEnvelope(env);
        if (!payload) continue;

        if (payload.type === 'full_state' && Array.isArray(payload.teams) && payload.teams.length > 0) {
          if (!latestFullState || payload.timestamp >= latestFullState.timestamp) {
            latestFullState = {
              tournamentName: payload.tournamentName || 'Tournament Check-In',
              totalCourtsAvailable: payload.totalCourtsAvailable || 18,
              teams: payload.teams,
              timestamp: payload.timestamp,
            };
          }
        } else if (payload.type === 'team_update' && payload.updatedTeam) {
          subsequentTeamUpdates.push({
            timestamp: payload.timestamp,
            team: payload.updatedTeam,
          });
        }
      } catch {
        // skip invalid line
      }
    }

    if (!latestFullState) return null;

    // Apply any team_update events that happened after the latest full_state
    const mergedMap = new Map<string, TeamEntry>();
    latestFullState.teams.forEach((t) => mergedMap.set(t.id, t));

    subsequentTeamUpdates
      .filter((u) => u.timestamp >= latestFullState!.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((u) => {
        if (mergedMap.has(u.team.id)) {
          mergedMap.set(u.team.id, u.team);
        }
      });

    return {
      ...latestFullState,
      teams: Array.from(mergedMap.values()),
    };
  } catch {
    return null;
  }
}

export function subscribeToLiveUpdates(
  onPayload: (payload: LiveSyncPayload) => void,
  topic: string = DEFAULT_SYNC_TOPIC
): () => void {
  let es: EventSource | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    try {
      es = new EventSource(`${NTFY_BASE_URL}/${encodeURIComponent(topic)}/sse`);
      es.onmessage = async (event) => {
        try {
          const env = JSON.parse(event.data) as NtfyEnvelope;
          const payload = await extractPayloadFromEnvelope(env);
          if (payload) {
            onPayload(payload);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore connection error
    }
  };

  connect();

  return () => {
    closed = true;
    es?.close();
  };
}
