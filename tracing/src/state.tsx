import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { readStored, writeStored } from "./hooks";
import type { Brand } from "./types";

interface BrandScope {
  brands: Brand[];
  brandId: string;
  setBrandId: (id: string) => void;
  brandName: (id: string) => string | undefined;
}

const Ctx = createContext<BrandScope>({ brands: [], brandId: "", setBrandId: () => {}, brandName: () => undefined });

export function BrandScopeProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandIdState] = useState(() => readStored("cft.brand") ?? "");

  useEffect(() => {
    let alive = true;
    const load = (attempt = 0) =>
      api
        .brands()
        .then((r) => alive && setBrands(r.items ?? []))
        .catch(() => {
          if (alive && attempt < 5) window.setTimeout(() => load(attempt + 1), 3000 * (attempt + 1));
        });
    void load();
    return () => {
      alive = false;
    };
  }, []);

  // Drop a stored brand that no longer exists.
  useEffect(() => {
    if (brandId && brands.length && !brands.some((b) => b.id === brandId)) setBrandIdState("");
  }, [brands, brandId]);

  const value = useMemo<BrandScope>(
    () => ({
      brands,
      brandId,
      setBrandId: (id) => {
        setBrandIdState(id);
        writeStored("cft.brand", id || null);
      },
      brandName: (id) => brands.find((b) => b.id === id)?.name,
    }),
    [brands, brandId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrandScope(): BrandScope {
  return useContext(Ctx);
}
