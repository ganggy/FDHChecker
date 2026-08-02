---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/services/repErrorCatalogService.ts"
source_hash: "30ec39fbc187e2eff4f3888cd16b081c05451d712290a0ca3ea03c331ccbb095"
managed_by: "sync-ksp-vault"
---
# repErrorCatalogService.ts

> Source: `src/services/repErrorCatalogService.ts`
> SHA-256: `30ec39fbc187e2eff4f3888cd16b081c05451d712290a0ca3ea03c331ccbb095`

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

````
