import { Injectable } from '@angular/core';

export interface HistoryItem {
  id: number;
  name: string;
  size: number;
  date: string;
  url: string;
  storagePath?: string;
  mimeType?: string;
  sourceFileName?: string;
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly storageKey = 'docswap-history';
  private readonly migrationVersionKey = 'docswap-history-migration-version';
  private readonly historyMigrationVersion = 2;
  private readonly legacyOutputName = 'output.docx';
  private history: HistoryItem[] = [];

  constructor() {
    this.loadHistory();
  }

  addToHistory(item: HistoryItem) {
    this.history = this.history.filter(existing =>
      !(existing.name === item.name && existing.date === item.date && existing.url === item.url)
    );
    this.history.unshift(item); // Item terbaru selalu di atas
    this.persistHistory();
  }

  getHistory() {
    return [...this.history];
  }

  // Hapus satu file
  deleteItem(id: number) {
    this.history = this.history.filter(item => item.id !== id);
    this.persistHistory();
    return [...this.history];
  }

  // Hapus semua
  clearAll() {
    this.history = [];
    this.persistHistory();
    return [];
  }

  async migrateLegacyEntries() {
    if (this.getStoredMigrationVersion() >= this.historyMigrationVersion) {
      return;
    }

    const usedNames = new Set<string>();
    let changed = false;
    const migratedHistory = this.history.map((item) => {
      const migratedItem = this.migrateHistoryItem(item, usedNames);
      if (!this.areHistoryItemsEqual(item, migratedItem)) {
        changed = true;
      }

      return migratedItem;
    });

    if (changed) {
      this.history = migratedHistory;
      this.persistHistory();
    }

    localStorage.setItem(this.migrationVersionKey, String(this.historyMigrationVersion));
  }

  private loadHistory() {
    try {
      const rawHistory = localStorage.getItem(this.storageKey);
      const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
      this.history = Array.isArray(parsedHistory) ? parsedHistory : [];
    } catch (error) {
      console.error('Gagal memuat history:', error);
      this.history = [];
    }
  }

  private persistHistory() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.history));
  }

  private getStoredMigrationVersion(): number {
    const rawVersion = localStorage.getItem(this.migrationVersionKey);
    const parsedVersion = Number(rawVersion);
    return Number.isFinite(parsedVersion) ? parsedVersion : 0;
  }

  private migrateHistoryItem(item: HistoryItem, usedNames: Set<string>): HistoryItem {
    const preferredName = this.resolveHistoryFileName(item);
    const uniqueName = this.ensureUniqueName(preferredName, usedNames);

    return {
      ...item,
      name: uniqueName,
      sourceFileName: item.sourceFileName || this.deriveSourceFileName(item),
    };
  }

  private resolveHistoryFileName(item: HistoryItem): string {
    const sourceDocxName = this.toDocxFileName(item.sourceFileName);
    if (sourceDocxName) {
      return sourceDocxName;
    }

    if (item.name && !this.isLegacyOutputName(item.name)) {
      return this.sanitizeDocxFileName(item.name);
    }

    const storageName = this.extractFileName(item.storagePath);
    if (storageName && !this.isLegacyOutputName(storageName)) {
      return this.sanitizeDocxFileName(storageName);
    }

    const urlName = this.extractFileName(item.url);
    if (urlName && !this.isLegacyOutputName(urlName)) {
      return this.sanitizeDocxFileName(urlName);
    }

    return this.buildLegacyFallbackName(item);
  }

  private deriveSourceFileName(item: HistoryItem): string {
    if (item.sourceFileName?.trim()) {
      return item.sourceFileName.trim();
    }

    const docxName = this.resolveHistoryFileName(item);
    return docxName.replace(/\.docx$/i, '.pdf');
  }

  private ensureUniqueName(fileName: string, usedNames: Set<string>): string {
    const safeFileName = this.sanitizeDocxFileName(fileName);
    const dotIndex = safeFileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? safeFileName.slice(0, dotIndex) : safeFileName;
    const extension = dotIndex > 0 ? safeFileName.slice(dotIndex) : '.docx';

    let candidate = `${baseName}${extension}`;
    let suffix = 2;

    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${baseName} (${suffix})${extension}`;
      suffix += 1;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  private sanitizeDocxFileName(fileName: string | undefined): string {
    const trimmedName = (fileName || '').trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    if (!trimmedName) {
      return this.legacyOutputName;
    }

    return trimmedName.toLowerCase().endsWith('.docx') ? trimmedName : `${trimmedName}.docx`;
  }

  private toDocxFileName(fileName: string | undefined): string {
    const trimmedName = (fileName || '').trim();
    if (!trimmedName) {
      return '';
    }

    return this.sanitizeDocxFileName(trimmedName.replace(/\.pdf$/i, '.docx'));
  }

  private extractFileName(pathOrUrl: string | undefined): string {
    if (!pathOrUrl) {
      return '';
    }

    const normalizedValue = pathOrUrl.split('?')[0].split('#')[0];
    const segments = normalizedValue.split(/[\\/]/);
    return decodeURIComponent(segments[segments.length - 1] || '').trim();
  }

  private isLegacyOutputName(fileName: string | undefined): boolean {
    return (fileName || '').trim().toLowerCase() === this.legacyOutputName;
  }

  private buildLegacyFallbackName(item: HistoryItem): string {
    const parsedDate = new Date(item.date);
    if (Number.isNaN(parsedDate.getTime())) {
      return `converted-${item.id}.docx`;
    }

    const datePart = [
      parsedDate.getFullYear(),
      String(parsedDate.getMonth() + 1).padStart(2, '0'),
      String(parsedDate.getDate()).padStart(2, '0'),
    ].join('');
    const timePart = [
      String(parsedDate.getHours()).padStart(2, '0'),
      String(parsedDate.getMinutes()).padStart(2, '0'),
      String(parsedDate.getSeconds()).padStart(2, '0'),
    ].join('');

    return `converted-${datePart}-${timePart}.docx`;
  }

  private areHistoryItemsEqual(left: HistoryItem, right: HistoryItem): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
