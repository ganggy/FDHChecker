---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/services/repErrorCatalogService.ts"
source_hash: "c2562eb00afdff97c393ab412a265fca6c901b4c3e92838c42ce5cfb2a9cd6d4"
managed_by: "sync-ksp-vault"
---
# repErrorCatalogService.ts

> Source: `src/services/repErrorCatalogService.ts`
> SHA-256: `c2562eb00afdff97c393ab412a265fca6c901b4c3e92838c42ce5cfb2a9cd6d4`

````typescript
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
    catalogPromise = fetch(catalogUrl, { cache: 'no-cache' })
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

````
