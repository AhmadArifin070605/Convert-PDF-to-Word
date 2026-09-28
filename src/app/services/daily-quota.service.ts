import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface DailyQuotaSnapshot {
  date: string;
  limit: number;
  used: number;
  pending: number;
  remaining: number;
  resetAt: string;
}

@Injectable({ providedIn: 'root' })
export class DailyQuotaService {
  private readonly defaultLimit = 3;
  private readonly apiUrl = this.buildApiUrl();
  private snapshot: DailyQuotaSnapshot = {
    date: '',
    limit: this.defaultLimit,
    used: 0,
    pending: 0,
    remaining: this.defaultLimit,
    resetAt: '',
  };

  constructor(private http: HttpClient) {}

  get limit(): number {
    return this.snapshot.limit;
  }

  getRemainingTokens(): number {
    return this.snapshot.remaining;
  }

  hasAvailableToken(): boolean {
    return this.snapshot.remaining > 0;
  }

  async refresh(): Promise<void> {
    if (!this.hasApiEndpoint()) {
      return;
    }

    try {
      const snapshot = await firstValueFrom(this.http.get<Partial<DailyQuotaSnapshot>>(this.apiUrl));
      this.updateSnapshot(snapshot);
    } catch (error) {
      console.error('Gagal memuat kuota harian dari backend:', error);
    }
  }

  applyResponseHeaders(headers: HttpHeaders | null | undefined): void {
    if (!headers) {
      return;
    }

    const limit = this.parseNumberHeader(headers, 'X-Docswap-Daily-Limit');
    const used = this.parseNumberHeader(headers, 'X-Docswap-Daily-Used');
    const pending = this.parseNumberHeader(headers, 'X-Docswap-Daily-Pending');
    const remaining = this.parseNumberHeader(headers, 'X-Docswap-Daily-Remaining');
    const date = headers.get('X-Docswap-Daily-Date') || undefined;
    const resetAt = headers.get('X-Docswap-Daily-Reset-At') || undefined;

    if (limit === null && used === null && pending === null && remaining === null && !date && !resetAt) {
      return;
    }

    this.updateSnapshot({
      date,
      limit: limit ?? undefined,
      used: used ?? undefined,
      pending: pending ?? undefined,
      remaining: remaining ?? undefined,
      resetAt,
    });
  }

  hasApiEndpoint(): boolean {
    return environment.backendBaseUrl.trim().length > 0;
  }

  private updateSnapshot(snapshot: Partial<DailyQuotaSnapshot>): void {
    const nextLimit = this.normalizeCount(snapshot.limit, this.snapshot.limit || this.defaultLimit);
    const nextUsed = this.normalizeCount(snapshot.used, this.snapshot.used);
    const nextPending = this.normalizeCount(snapshot.pending, this.snapshot.pending);
    const computedRemaining = Math.max(nextLimit - nextUsed - nextPending, 0);
    const nextRemaining = this.normalizeCount(snapshot.remaining, computedRemaining);

    this.snapshot = {
      date: snapshot.date ?? this.snapshot.date,
      limit: nextLimit,
      used: nextUsed,
      pending: nextPending,
      remaining: Math.min(nextRemaining, nextLimit),
      resetAt: snapshot.resetAt ?? this.snapshot.resetAt,
    };
  }

  private normalizeCount(value: number | undefined, fallbackValue: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return Math.max(fallbackValue, 0);
    }

    return Math.max(Math.floor(value), 0);
  }

  private parseNumberHeader(headers: HttpHeaders, name: string): number | null {
    const rawValue = headers.get(name);
    if (rawValue === null) {
      return null;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  private buildApiUrl(): string {
    const baseUrl = environment.backendBaseUrl.trim().replace(/\/+$/, '');
    return baseUrl ? `${baseUrl}/api/quota` : '/api/quota';
  }
}
