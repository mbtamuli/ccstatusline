import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getClaudeConfigDir } from './claude-settings';

interface OAuthCredentials { claudeAiOauth?: { accessToken?: string } }

interface UsageAPIResponse {
    five_hour?: {
        utilization?: number;
        resets_at?: string;
    };
}

export interface UsageCacheEntry {
    utilization: number;
    resetsAt: string;
    fetchedAt: string;
}

const CACHE_TTL_MS = 60_000;
const API_TIMEOUT_SECONDS = 3;
const API_URL = 'https://api.anthropic.com/api/oauth/usage';
const API_BETA_HEADER = 'oauth-2025-04-20';

function getUsageCachePath(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'usage-cache.json');
}

export function getOAuthToken(): string | null {
    try {
        if (process.platform === 'darwin') {
            const raw = execSync(
                'security find-generic-password -s "Claude Code-credentials" -w',
                { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }
            ).trim();
            const creds = JSON.parse(raw) as OAuthCredentials;
            return creds.claudeAiOauth?.accessToken ?? null;
        }

        if (process.platform === 'linux') {
            const credPath = path.join(getClaudeConfigDir(), '.credentials.json');
            if (!fs.existsSync(credPath))
                return null;
            const raw = fs.readFileSync(credPath, 'utf-8');
            const creds = JSON.parse(raw) as OAuthCredentials;
            return creds.claudeAiOauth?.accessToken ?? null;
        }

        return null;
    } catch {
        return null;
    }
}

function fetchUsageFromAPI(token: string): UsageCacheEntry | null {
    try {
        const output = execSync(
            `curl -s --max-time ${API_TIMEOUT_SECONDS} "${API_URL}" -H "Authorization: Bearer ${token}" -H "anthropic-beta: ${API_BETA_HEADER}"`,
            { encoding: 'utf8', timeout: (API_TIMEOUT_SECONDS + 1) * 1000, stdio: ['pipe', 'pipe', 'ignore'] }
        ).trim();

        const data = JSON.parse(output) as UsageAPIResponse;
        const fiveHour = data.five_hour;
        if (!fiveHour || typeof fiveHour.utilization !== 'number' || typeof fiveHour.resets_at !== 'string') {
            return null;
        }

        const resetsAtDate = new Date(fiveHour.resets_at);
        if (Number.isNaN(resetsAtDate.getTime()))
            return null;

        return {
            utilization: fiveHour.utilization,
            resetsAt: fiveHour.resets_at,
            fetchedAt: new Date().toISOString()
        };
    } catch {
        return null;
    }
}

function readUsageCache(): UsageCacheEntry | null {
    try {
        const cachePath = getUsageCachePath();
        if (!fs.existsSync(cachePath))
            return null;

        const content = fs.readFileSync(cachePath, 'utf-8');
        const entry = JSON.parse(content) as UsageCacheEntry;

        if (typeof entry.utilization !== 'number' || typeof entry.resetsAt !== 'string' || typeof entry.fetchedAt !== 'string') {
            return null;
        }

        const age = Date.now() - new Date(entry.fetchedAt).getTime();
        if (age > CACHE_TTL_MS)
            return null;

        return entry;
    } catch {
        return null;
    }
}

function writeUsageCache(entry: UsageCacheEntry): void {
    try {
        const cachePath = getUsageCachePath();
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(cachePath, JSON.stringify(entry), 'utf-8');
    } catch {
        // Best-effort caching
    }
}

export function getCachedUsage(): UsageCacheEntry | null {
    const cached = readUsageCache();
    if (cached)
        return cached;

    const token = getOAuthToken();
    if (!token)
        return null;

    const usage = fetchUsageFromAPI(token);
    if (!usage)
        return null;

    writeUsageCache(usage);
    return usage;
}