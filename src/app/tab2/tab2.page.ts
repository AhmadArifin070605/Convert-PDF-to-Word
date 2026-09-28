import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { HistoryService, HistoryItem } from '../services/history';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import { addIcons } from 'ionicons';
import { trashOutline, downloadOutline, shareSocialOutline, archiveOutline, documentTextOutline, ellipsisHorizontal } from 'ionicons/icons';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class Tab2Page {
  history: HistoryItem[] = [];
  selectedHistoryId: number | null = null;

  constructor(
    private historyService: HistoryService,
    private toastCtrl: ToastController
  ) {
    addIcons({ trashOutline, downloadOutline, shareSocialOutline, archiveOutline, documentTextOutline, ellipsisHorizontal });
  }

  ionViewWillEnter() {
    this.loadHistory();
  }

  loadHistory() {
    this.history = this.historyService.getHistory();
    if (this.selectedHistoryId !== null && !this.history.some(item => item.id === this.selectedHistoryId)) {
      this.selectedHistoryId = null;
    }
  }

  async clearAllHistory() {
    for (const item of this.history) {
      await this.removeStoredFile(item);
    }

    this.history = this.historyService.clearAll();
    this.selectedHistoryId = null;
    this.showToast('Semua riwayat dihapus');
  }

  toggleFileActions(item: HistoryItem) {
    this.selectedHistoryId = this.selectedHistoryId === item.id ? null : item.id;
  }

  isExpanded(item: HistoryItem): boolean {
    return this.selectedHistoryId === item.id;
  }

  formatHistoryDate(date: string): string {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(parsed);
  }

  async deleteItem(id: number) {
    const item = this.history.find(entry => entry.id === id);
    await this.removeStoredFile(item);
    this.history = this.historyService.deleteItem(id);
    if (this.selectedHistoryId === id) {
      this.selectedHistoryId = null;
    }
    this.showToast('Riwayat dihapus');
  }

  async openHistoryFile(item: HistoryItem) {
    try {
      if (this.isWebPlatform()) {
        window.open(item.url, '_blank');
        return;
      }

      if (!item.url) {
        this.showToast('File tidak ditemukan di riwayat.');
        return;
      }

      const options: any = {
        filePath: item.url,
        mimeType: item.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: item.name
      };

      await FileOpener.open(options);
    } catch (error) {
      console.error('Gagal membuka file history:', error);
      this.showToast('Gagal membuka file hasil convert.');
    }
  }

  async shareAgain(item: HistoryItem) {
    try {
      if (this.isWebPlatform() && item.url.startsWith('blob:')) {
        this.showToast('File sesi lama di browser sudah tidak tersedia.');
        return;
      }

      const shareableFilePath = this.isWebPlatform()
        ? item.url
        : await this.getNativeSharePath(item);

      if (!shareableFilePath) {
        this.showToast('File riwayat tidak ditemukan untuk dibagikan.');
        return;
      }

      await Share.share({
        title: item.name,
        text: 'File dari DocSwap: ' + item.name,
        ...(this.isWebPlatform()
          ? { url: shareableFilePath }
          : { files: [shareableFilePath], dialogTitle: 'Bagikan file' }),
      });
    } catch (e) {
      console.error(e);
      this.showToast('Gagal membagikan file.');
    }
  }

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 2000 });
    toast.present();
  }

  private async removeStoredFile(item?: HistoryItem) {
    if (!item?.storagePath || this.isWebPlatform()) {
      return;
    }

    try {
      await Filesystem.deleteFile({
        path: item.storagePath,
        directory: Directory.Data
      });
    } catch (error) {
      console.warn('Gagal menghapus file history dari storage:', error);
    }
  }

  private isWebPlatform(): boolean {
    return Capacitor.getPlatform() === 'web';
  }

  private async getNativeSharePath(item: HistoryItem): Promise<string> {
    if (item.storagePath) {
      try {
        const { uri } = await Filesystem.getUri({
          path: item.storagePath,
          directory: Directory.Data
        });
        return uri;
      } catch (error) {
        console.warn('Gagal mengambil URI riwayat untuk dibagikan:', error);
      }
    }

    return item.url;
  }
}
