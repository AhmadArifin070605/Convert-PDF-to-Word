import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { RouterLink } from '@angular/router';
import { FilePicker, PickedFile } from '@capawesome/capacitor-file-picker';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import { SharedDocuments } from '../plugins/shared-documents';
import { HistoryService } from '../services/history';
import { PdfConverterService } from '../services/pdf-converter.service';
import { DailyQuotaService } from '../services/daily-quota.service';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { addIcons } from 'ionicons';
import {
  cloudUploadOutline, documentTextOutline, closeCircleOutline,
  arrowForwardOutline, checkmarkCircleOutline, downloadOutline,
  shareSocialOutline, alertCircleOutline, wifiOutline
} from 'ionicons/icons';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterLink]
})
export class Tab1Page implements OnInit, OnDestroy {
  private readonly autoExportFolderName = 'DocSwap';
  private readonly maxPdfSizeBytes = 3 * 1024 * 1024;
  private readonly maxPdfSizeLabel = '3 MB';
  private activeConversionPromise: Promise<void> | null = null;

  @ViewChild('webUploadInput') webUploadInput?: ElementRef<HTMLInputElement>;

  selectedFile: PickedFile | null = null;
  convertedFileName: string = '';
  savedFilePath: string = '';
  savedStoragePath: string = '';
  savedFileBlob: Blob | null = null;
  savedFileData: string = '';
  selectedFileRequestKey: string = '';
  webFileUrl: string = '';
  errorMessage: string = '';
  exportMessage: string = '';
  status: 'idle' | 'converting' | 'done' = 'idle';
  dailyTokenLimit = 3;
  dailyTokensRemaining = 3;
  showOfflineModal = false;

  get quotaExhausted(): boolean {
    return this.dailyTokensRemaining <= 0;
  }

  get convertButtonDisabled(): boolean {
    return this.quotaExhausted || Boolean(this.activeConversionPromise);
  }

  get dailyTokenLabel(): string {
    return `${this.dailyTokensRemaining}/${this.dailyTokenLimit} tokens left today`;
  }

  get primaryActionLabel(): string {
    return this.isWebPlatform() ? 'Download' : 'Open';
  }

  get selectedFileSizeLabel(): string {
    if (!this.selectedFile?.size) {
      return 'Unknown size';
    }

    return `${(this.selectedFile.size / 1024).toFixed(1)} KB`;
  }

  get currentPlatformLabel(): string {
    return this.isWebPlatform() ? 'Web ready' : 'Android ready';
  }

  get isWebUpload(): boolean {
    return this.isWebPlatform();
  }

  constructor(
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController,
    private historyService: HistoryService,
    private pdfService: PdfConverterService,
    private quotaService: DailyQuotaService
  ) {
    addIcons({
      cloudUploadOutline, documentTextOutline, closeCircleOutline,
      arrowForwardOutline, checkmarkCircleOutline, downloadOutline,
      shareSocialOutline, alertCircleOutline, wifiOutline
    });
  }

  ngOnInit() {
    void this.refreshDailyQuota();
    window.addEventListener('online', () => {
      this.showOfflineModal = false;
    });
  }

  ngOnDestroy() {
    this.destroyWebFileUrl();
  }

  async pickFile() {
    try {
      const result = await FilePicker.pickFiles({
        types: ['application/pdf'],
        limit: 1,
        readData: true
      });

      if (result.files.length > 0) {
        this.runInZone(() => this.applyPickedFile(result.files[0]));
      }
    } catch (error) {
      console.error("Gagal pilih file:", error);
      this.showToast("Gagal memilih file PDF.");
    }
  }

  removeFile() {
    this.resetViewState();
  }

  async convertFile() {
    if (!this.selectedFile || this.status === 'converting' || this.activeConversionPromise) {
      console.warn('Duplicate convert tap ignored.', {
        status: this.status,
        hasActiveConversion: Boolean(this.activeConversionPromise),
        requestKey: this.selectedFileRequestKey
      });
      return;
    }

    this.activeConversionPromise = this.runConvertFlow()
      .finally(() => {
        this.activeConversionPromise = null;
      });

    await this.activeConversionPromise;
  }

  private async runConvertFlow() {
    if (!this.selectedFile) {
      return;
    }

    // 🔥 1. CEK OFFLINE SEBELUM REQUEST
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.runInZone(() => {
        this.status = 'idle';
        this.errorMessage = '';
        this.showOfflineModal = true;
      });
      return;
    }

    if (!this.validatePickedFileSize(this.selectedFile)) {
      return;
    }

    await this.refreshDailyQuota();
    if (!this.quotaService.hasAvailableToken()) {
      this.runInZone(() => {
        this.errorMessage = 'The daily conversion token has expired. Please try again tomorrow.';
      });
      this.showToast(this.errorMessage);
      return;
    }

    this.status = 'converting';
    this.errorMessage = '';
    this.clearResultState();

    try {
      if (!this.pdfService.hasApiEndpoint()) {
        throw new Error('URL backend convert belum diisi.');
      }

      const blob = await this.createPdfBlob(this.selectedFile);
      const fileDataBase64 = await this.blobToBase64(blob);

      const response = await firstValueFrom(
        this.pdfService.convertPdfToWord(
          fileDataBase64,
          this.selectedFile.name,
          this.selectedFileRequestKey
        )
      );

      this.quotaService.applyResponseHeaders(response.headers);
      this.syncDailyQuotaFromService();

      const convertedBlob = response.body;

      if (!convertedBlob) {
        throw new Error('Respons API tidak berisi file hasil konversi.');
      }

      const fileName = this.getConvertedFileName(
        response.headers.get('content-disposition'),
        this.selectedFile.name
      );

      const fileData = await this.blobToBase64(convertedBlob);

      await this.storeConvertedFile(fileName, fileData, convertedBlob);
      await this.autoExportToDocuments();

      this.runInZone(() => {
        this.status = 'done';
        this.historyService.addToHistory({
          id: Date.now(),
          name: fileName,
          size: this.selectedFile?.size ?? 0,
          date: new Date().toISOString(),
          url: this.savedFilePath,
          storagePath: this.savedStoragePath,
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceFileName: this.selectedFile?.name
        });
      });

      this.showToast(this.exportMessage || "Conversion successful!");

    } catch (e: any) {

      // 🔥 2. HANDLE OFFLINE SAAT REQUEST (INI YANG KAMU BUTUH)
      if (e?.status === 0) {
        this.runInZone(() => {
          this.status = 'idle';
          this.errorMessage = '';
          this.showOfflineModal = true;
        });
        return;
      }

      // =============================
      // ERROR NORMAL (API DLL)
      // =============================
      console.error('Convert error:', e);

      this.quotaService.applyResponseHeaders(e?.headers);
      this.syncDailyQuotaFromService();

      const errorMessage = await this.resolveErrorMessage(e);

      this.runInZone(() => {
        this.status = 'idle';
        this.errorMessage = errorMessage;
      });

      this.showToast(this.errorMessage);
    }
  }

  async downloadFile() {
    try {
      if (this.isWebPlatform()) {
        if (!this.webFileUrl) {
          throw new Error('File hasil belum tersedia untuk browser.');
        }

        const link = document.createElement('a');
        link.href = this.webFileUrl;
        link.download = this.convertedFileName || 'converted.docx';
        link.click();
        return;
      }

      const options: any = {
        filePath: this.savedFilePath,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: this.convertedFileName
      };

      await FileOpener.open(options);
    } catch (e) {
      console.error("Gagal membuka file:", e);
      this.showToast(this.isWebPlatform()
        ? "Failed to download the converted file."
        : "No application available to open this document.");
    }
  }

  async onWebFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > this.maxPdfSizeBytes) {
      this.errorMessage = "File terlalu besar (maks 3MB)";
      this.showToast(this.errorMessage);
      return;
    }

    try {
      const data = await this.readFileAsBase64(file);
      this.applyPickedFile({
        blob: file,
        data,
        mimeType: file.type || 'application/pdf',
        modifiedAt: file.lastModified,
        name: file.name,
        path: undefined,
        size: file.size
      });
    } catch (error) {
      console.error('Gagal membaca file web:', error);
      this.showToast('Gagal membaca file PDF dari browser.');
    } finally {
      input.value = '';
    }
  }

  openWebFilePicker(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    const input = this.webUploadInput?.nativeElement;

    if (!input) {
      return;
    }

    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  }

  async shareFile() {
    try {
      if (this.isWebPlatform()) {
        if (navigator.share && this.savedFileBlob) {
          const sharedFile = new File([this.savedFileBlob], this.convertedFileName || 'converted.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          });

          await navigator.share({
            title: 'DocSwap Result',
            files: [sharedFile]
          });
          return;
        }

        await this.downloadFile();
        return;
      }

      const shareableFilePath = await this.getNativeSharePath(this.savedStoragePath, this.savedFilePath);

      if (!shareableFilePath) {
        this.showToast('File hasil belum tersedia untuk dibagikan.');
        return;
      }

      await Share.share({
        title: 'DocSwap Result',
        text: this.convertedFileName || 'Hasil konversi DocSwap',
        files: [shareableFilePath],
        dialogTitle: 'Bagikan file hasil convert'
      });
    } catch (error) {
      console.error('Gagal share file:', error);
      this.showToast('Failed to share converted file.');
    }
  }

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 2000 });
    toast.present();
  }

  async retry() {
    if (navigator.onLine) {
      this.showOfflineModal = false;
      await this.convertFile() // ulang convert
    }
  }

  private async createPdfBlob(file: PickedFile): Promise<Blob> {
    if (file.blob) {
      return file.blob;
    }

    if (file.data) {
      return this.base64ToBlob(file.data, file.mimeType || 'application/pdf');
    }

    if (file.path) {
      const response = await fetch(file.path);
      return response.blob();
    }

    throw new Error('File PDF tidak bisa dibaca dari perangkat.');
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  }

  private async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.split('base64,')[1] || '');
      };

      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.split('base64,')[1] || '');
      };

      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  private getErrorMessage(error: any): string {
    const backendMessage = this.extractBackendMessage(error);

    if (error?.status === 401 || error?.status === 403) {
      return 'Access to the conversion backend is denied. Please check your backend configuration.';
    }

    if (error?.status === 429) {
      return 'Too many requests to the conversion backend. Please try again later.';
    }

    if (error?.status === 500) {
      if (backendMessage && backendMessage !== 'An error occurred in the conversion backend.') {
        return backendMessage;
      }

      return 'The conversion service is experiencing problems. Please try again later.';
    }

    if (error?.status === 0) {
      return 'Cannot connect to the conversion server. Please check your internet connection or the HTTPS backend.';
    }

    if (backendMessage) {
      return backendMessage;
    }

    if (typeof error?.message === 'string' && error.message.trim()) {
      return error.message;
    }

    return 'Conversion failed to execute.';
  }

  private async resolveErrorMessage(error: any): Promise<string> {
    if (error?.error instanceof Blob) {
      try {
        const rawText = await error.error.text();
        const parsed = JSON.parse(rawText) as { message?: string; Message?: string };
        console.error('Convert backend error details:', {
          status: error?.status,
          message: parsed.message || parsed.Message || null,
        });
        if (parsed.message) {
          return this.normalizeBackendErrorMessage(parsed.message, error?.status);
        }
        if (parsed.Message) {
          return this.normalizeBackendErrorMessage(parsed.Message, error?.status);
        }
      } catch {
        // Fall back to default handling below.
      }
    }

    return this.getErrorMessage(error);
  }

  private extractBackendMessage(error: any): string {
    if (typeof error?.error?.message === 'string' && error.error.message.trim()) {
      return this.normalizeBackendErrorMessage(error.error.message, error?.status);
    }

    if (typeof error?.error?.Message === 'string' && error.error.Message.trim()) {
      return this.normalizeBackendErrorMessage(error.error.Message, error?.status);
    }

    return '';
  }

  private normalizeBackendErrorMessage(message: string, status?: number): string {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return '';
    }

    if (status === 500 && trimmedMessage === 'An error occurred in the conversion backend.') {
      return 'The conversion service is experiencing problems. Please try again later.';
    }

    return trimmedMessage;
  }

  private getConvertedFileName(contentDisposition: string | null, originalFileName: string): string {
    const fallbackName = originalFileName.replace(/\.pdf$/i, '.docx');

    if (!contentDisposition) {
      return fallbackName;
    }

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      const decodedName = decodeURIComponent(utf8Match[1]);
      return this.isGenericConvertedFileName(decodedName) ? fallbackName : decodedName;
    }

    const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    const resolvedName = asciiMatch?.[1] || fallbackName;
    return this.isGenericConvertedFileName(resolvedName) ? fallbackName : resolvedName;
  }

  private applyPickedFile(file: PickedFile) {
    this.errorMessage = '';
    if (!this.validatePickedFileSize(file)) {
      this.clearResultState();
      this.selectedFile = null;
      this.selectedFileRequestKey = '';
      this.status = 'idle';
      return;
    }

    this.resetViewState();
    this.selectedFile = file;
    this.selectedFileRequestKey = this.createRequestKey();
    this.status = 'idle';
  }

  private validatePickedFileSize(file: PickedFile): boolean {
    const fileSize = this.getPickedFileSize(file);

    if (!fileSize || fileSize <= this.maxPdfSizeBytes) {
      return true;
    }

    const message = `Maximum file size ${this.maxPdfSizeLabel}. Select a smaller PDF file.`;
    this.errorMessage = message;
    this.showToast(message);
    return false;
  }

  private getPickedFileSize(file: PickedFile): number {
    if (typeof file.size === 'number' && file.size > 0) {
      return file.size;
    }

    if (file.blob?.size) {
      return file.blob.size;
    }

    return 0;
  }

  private runInZone(callback: () => void) {
    this.ngZone.run(() => {
      callback();
      this.cdr.detectChanges();
    });
  }

  private async refreshDailyQuota() {
    await this.quotaService.refresh();
    this.syncDailyQuotaFromService();
  }

  private syncDailyQuotaFromService() {
    this.dailyTokenLimit = this.quotaService.limit;
    this.dailyTokensRemaining = this.quotaService.getRemainingTokens();
  }

  private clearResultState() {
    this.destroyWebFileUrl();
    this.convertedFileName = '';
    this.savedFilePath = '';
    this.savedStoragePath = '';
    this.savedFileBlob = null;
    this.savedFileData = '';
    this.exportMessage = '';
  }

  private resetViewState() {
    this.clearResultState();
    this.selectedFile = null;
    this.selectedFileRequestKey = '';
    this.errorMessage = '';
    this.status = 'idle';
  }

  private async storeConvertedFile(fileName: string, fileData: string, convertedBlob: Blob) {
    this.convertedFileName = fileName;
    this.savedFileBlob = convertedBlob;
    this.savedFileData = fileData;

    if (this.isWebPlatform()) {
      this.webFileUrl = URL.createObjectURL(convertedBlob);
      this.savedFilePath = this.webFileUrl;
      this.savedStoragePath = '';
      return;
    }

    const safeFileName = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    const uniqueSafeFileName = await this.createUniqueNativeFileName(safeFileName);
    const savedFile = await Filesystem.writeFile({
      path: uniqueSafeFileName,
      data: fileData,
      directory: Directory.Data,
      recursive: true
    });

    this.savedStoragePath = uniqueSafeFileName;
    this.savedFilePath = savedFile.uri;
    this.convertedFileName = uniqueSafeFileName;
  }

  private async autoExportToDocuments() {
    if (this.isWebPlatform()) {
      this.exportMessage = 'The file is ready to download from your browser..';
      return;
    }

    if (!this.savedFileData || !this.convertedFileName) {
      this.exportMessage = '';
      return;
    }

    try {
      const exportName = this.convertedFileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
      const savedDocument = await SharedDocuments.saveFile({
        fileName: exportName,
        base64Data: this.savedFileData,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        subdirectory: this.autoExportFolderName
      });

      this.exportMessage = savedDocument.isPublicLocation
        ? `The file will be automatically saved to the Documents folder./${this.autoExportFolderName}.`
        : 'The file will be automatically saved to the application\'s document storage on this device.';
    } catch (error) {
      console.error('Failed to automatically export to Documents:', error);
      this.exportMessage = 'Conversion successful. The file remains saved in the app, but the copy to Documents could not be created.';
    }
  }

  private destroyWebFileUrl() {
    if (!this.webFileUrl) {
      return;
    }

    URL.revokeObjectURL(this.webFileUrl);
    this.webFileUrl = '';
  }

  private isWebPlatform(): boolean {
    return Capacitor.getPlatform() === 'web';
  }

  private async getNativeSharePath(storagePath: string, fallbackPath: string): Promise<string> {
    if (this.isWebPlatform()) {
      return fallbackPath;
    }

    if (storagePath) {
      try {
        const { uri } = await Filesystem.getUri({
          path: storagePath,
          directory: Directory.Data
        });
        return uri;
      } catch (error) {
        console.warn('Gagal mengambil URI file untuk dibagikan:', error);
      }
    }

    return fallbackPath;
  }

  private async createUniqueNativeFileName(fileName: string): Promise<string> {
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';

    let candidate = fileName;
    let suffix = 2;

    while (await this.nativeFileExists(candidate)) {
      candidate = `${baseName} (${suffix})${extension}`;
      suffix += 1;
    }

    return candidate;
  }

  private async nativeFileExists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({
        path,
        directory: Directory.Data
      });
      return true;
    } catch {
      return false;
    }
  }

  private isGenericConvertedFileName(fileName: string): boolean {
    const normalized = fileName.trim().toLowerCase();
    return normalized === 'output.docx' || normalized === 'converted.docx';
  }

  private createRequestKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `docswap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}


