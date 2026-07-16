export interface RepErrorCatalogEntry {
  type: string;
  description: string;
  guide: string;
}

export type RepErrorCatalog = Record<string, RepErrorCatalogEntry>;

let catalogPromise: Promise<RepErrorCatalog> | null = null;

export const loadRepErrorCatalog = () => {
  if (!catalogPromise) {
    const catalogUrl = `${import.meta.env.BASE_URL}repErrorCatalog.json`;
    catalogPromise = fetch(catalogUrl, { cache: 'force-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`โหลดคำอธิบาย REP ไม่สำเร็จ (${response.status})`);
        return response.json() as Promise<RepErrorCatalog>;
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
};
