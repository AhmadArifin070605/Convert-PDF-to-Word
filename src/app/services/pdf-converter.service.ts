import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { finalize, Observable, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PdfConverterService {
    private apiUrl = this.buildApiUrl();
    private readonly inflightRequests = new Map<string, Observable<HttpResponse<Blob>>>();

    constructor(private http: HttpClient) { }

    convertPdfToWord(fileDataBase64: string, fileName: string, idempotencyKey?: string): Observable<HttpResponse<Blob>> {
        const requestKey = idempotencyKey?.trim() || '';
        if (requestKey) {
            const activeRequest = this.inflightRequests.get(requestKey);
            if (activeRequest) {
                return activeRequest;
            }
        }

        const headers = idempotencyKey
            ? { 'X-Idempotency-Key': idempotencyKey }
            : undefined;

        const request$ = this.http.post(this.apiUrl, {
            fileName,
            fileDataBase64
        }, {
            headers,
            observe: 'response',
            responseType: 'blob'
        }).pipe(
            shareReplay(1),
            finalize(() => {
                if (requestKey) {
                    this.inflightRequests.delete(requestKey);
                }
            })
        );

        if (requestKey) {
            this.inflightRequests.set(requestKey, request$);
        }

        return request$;
    }

    hasApiEndpoint(): boolean {
        return environment.backendBaseUrl.trim().length > 0;
    }

    private buildApiUrl(): string {
        const baseUrl = environment.backendBaseUrl.trim().replace(/\/+$/, '');
        return baseUrl ? `${baseUrl}/api/convert/pdf-to-docx` : '/api/convert/pdf-to-docx';
    }
}
