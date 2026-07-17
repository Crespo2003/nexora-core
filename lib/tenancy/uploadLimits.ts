export const maxTenancyUploadBytes = 50 * 1024 * 1024;

// Multipart requests include a small boundary overhead. The file itself remains
// capped at maxTenancyUploadBytes in both the browser and server validation.
export const maxTenancyUploadRequestBytes = maxTenancyUploadBytes + (1024 * 1024);
