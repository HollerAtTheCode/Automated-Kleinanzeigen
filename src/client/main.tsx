import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ExternalLink, ImagePlus, Loader2, Search, Send, Sparkles, Trash2 } from "lucide-react";
import type { ComparableListing, ListingDraft, PriceRecommendation, ProductAnalysis, SessionState } from "../shared/types.js";
import "./styles.css";

type Step = "upload" | "analysis" | "pricing" | "draft" | "publish";

type Settings = {
  hasOpenaiApiKey: boolean;
  openaiModel: string;
};

const conditionLabels: Record<ProductAnalysis["condition"], string> = {
  new: "Neu",
  like_new: "Wie neu",
  good: "Gut",
  fair: "Gebraucht",
  defective: "Defekt",
  unknown: "Bitte auswählen"
};

const fulfillmentLabels = {
  pickup: "Nur Abholung",
  shipping: "Versand möglich"
} as const;

const priceTypeLabels = {
  fixed: "Festpreis",
  negotiable: "VB"
} as const;

const shippingLine = "Privatverkauf, keine Garantie oder Rücknahme durch mich. Versand oder Abholung nach Absprache möglich.";
const pickupLine = "Privatverkauf, keine Garantie oder Rücknahme durch mich. Nur Abholung.";

function withFinalListingLine(text: string, fulfillmentMethod: NonNullable<ProductAnalysis["fulfillmentMethod"]>) {
  const body = text
    .replace(shippingLine, "")
    .replace(pickupLine, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const finalLine = fulfillmentMethod === "pickup" ? pickupLine : shippingLine;
  return [body, finalLine].filter(Boolean).join("\n\n");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [productForm, setProductForm] = useState({
    productType: "",
    brand: "",
    model: "",
    condition: "unknown" as ProductAnalysis["condition"],
    category: "",
    notes: "",
    price: "",
    fulfillmentMethod: "shipping" as NonNullable<ProductAnalysis["fulfillmentMethod"]>,
    priceType: "negotiable" as NonNullable<ProductAnalysis["priceType"]>
  });
  const [comparables, setComparables] = useState<ComparableListing[]>([]);
  const [priceRecommendation, setPriceRecommendation] = useState<PriceRecommendation | null>(null);
  const [priceEdited, setPriceEdited] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SessionState>("/api/session", { method: "POST" }).then(setSession).catch((err: Error) => setError(err.message));
    api<Settings>("/api/settings").then(setSettings).catch((err: Error) => setError(err.message));
  }, []);

  const run = async <T,>(label: string, task: () => Promise<T>) => {
    setBusy(label);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const selectFiles = useCallback((incoming: FileList | File[]) => {
    const next = [...incoming].filter((file) => file.type.startsWith("image/"));
    setFiles((current) => [...current, ...next].slice(0, 12));
  }, []);

  const uploadAndAnalyze = async () => {
    if (!session || files.length === 0 || !settings?.hasOpenaiApiKey) return;
    await run("Bilder werden analysiert", async () => {
      const form = new FormData();
      files.forEach((file) => form.append("images", file));
      const uploaded = await api<SessionState>(`/api/session/${session.id}/images`, { method: "POST", body: form });
      setSession(uploaded);
      const result = await api<ProductAnalysis>(`/api/session/${session.id}/analyze`, { method: "POST" });
      setAnalysis(result);
      const fulfillmentMethod = result.fulfillmentMethod ?? "shipping";
      setProductForm({
        productType: result.productType === "Unbekannter Artikel" ? "" : result.productType,
        brand: result.brand ?? "",
        model: result.model ?? "",
        condition: result.condition,
        category: result.suggestedCategory && result.suggestedCategory !== "Sonstiges" ? result.suggestedCategory : "",
        notes: withFinalListingLine(result.saleNotes ?? "", fulfillmentMethod),
        price: "",
        fulfillmentMethod,
        priceType: result.priceType ?? "negotiable"
      });
      setPriceEdited(false);
      setStep("analysis");
    });
  };

  const saveApiKey = async () => {
    await run("API-Key wird verbunden", async () => {
      const updated = await api<Settings>("/api/settings/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      });
      setSettings(updated);
      setApiKey("");
    });
  };

  const canOpenStep = (target: Step) => {
    if (target === "upload") return true;
    if (target === "analysis") return Boolean(analysis);
    if (target === "pricing") return Boolean(analysis);
    if (target === "draft") return Boolean(draft);
    return Boolean(draft);
  };

  const openStep = (target: Step) => {
    if (canOpenStep(target)) {
      setStep(target);
      return;
    }
    setError("Bitte schließe zuerst den vorherigen Schritt ab.");
  };

  const buildSearchQueries = (data = productForm) => {
    const primary = [data.brand, data.model, data.productType].filter(Boolean).join(" ").trim();
    const brandModel = [data.brand, data.model].filter(Boolean).join(" ").trim();
    const fallback = data.productType.trim();
    return [...new Set([brandModel, primary, fallback, ...(analysis?.searchQueries ?? [])].filter((query) => query.length > 2))].slice(0, 4);
  };

  const saveProductDetails = async () => {
    if (!session || !analysis) return null;
    const productType = productForm.productType.trim();
    const category = productForm.category.trim();
    const saleNotes = withFinalListingLine(productForm.notes, productForm.fulfillmentMethod);
    if (!productType || productForm.condition === "unknown" || !category) {
      setError("Bitte fülle Produkt, Zustand und Kategorie aus.");
      return null;
    }

    setProductForm((current) => ({ ...current, notes: saleNotes }));
    return run("Angaben werden gespeichert", async () => {
      const updated = await api<ProductAnalysis>(`/api/session/${session.id}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...analysis,
          productType,
          brand: productForm.brand.trim() || undefined,
          model: productForm.model.trim() || undefined,
          condition: productForm.condition,
          suggestedCategory: category,
          saleNotes,
          fulfillmentMethod: productForm.fulfillmentMethod,
          priceType: productForm.priceType,
          searchQueries: buildSearchQueries()
        })
      });
      setAnalysis(updated);
      return updated;
    });
  };

  const searchPrices = async () => {
    if (!session || !analysis) return;
    const updatedAnalysis = await saveProductDetails();
    if (!updatedAnalysis) return;
    await run("Vergleichsangebote werden gesucht", async () => {
      const result = await api<ComparableListing[]>(`/api/session/${session.id}/price-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: updatedAnalysis.searchQueries })
      });
      setComparables(result);
      const notesResult = await api<{ saleNotes: string }>(`/api/session/${session.id}/sale-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: productForm.notes })
      });
      if (notesResult.saleNotes) {
        setProductForm((current) => ({ ...current, notes: withFinalListingLine(notesResult.saleNotes, current.fulfillmentMethod) }));
        setAnalysis((current) =>
          current ? { ...current, saleNotes: withFinalListingLine(notesResult.saleNotes, productForm.fulfillmentMethod) } : current
        );
      }
      const price = await api<PriceRecommendation>(`/api/session/${session.id}/price-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedListingIds: [...excluded] })
      });
      setPriceRecommendation(price);
      if (price.suggestedPrice) {
        setProductForm((current) => ({ ...current, price: current.price || String(price.suggestedPrice) }));
      }
      setStep("pricing");
    });
  };

  const generateDraft = async () => {
    if (!session || !analysis) return;
    const updatedAnalysis = await saveProductDetails();
    if (!updatedAnalysis) return;
    await run("Anzeige wird vorbereitet", async () => {
      const result = await api<ListingDraft>(`/api/session/${session.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excludedListingIds: [...excluded],
          manualPrice: productForm.price.trim() ? Number(productForm.price) : undefined,
          fulfillmentMethod: productForm.fulfillmentMethod,
          priceType: productForm.priceType
        })
      });
      setDraft(result);
      setStep("draft");
    });
  };

  const publishAssist = async () => {
    if (!session) return;
    await run("Browser wird geöffnet", async () => {
      await api(`/api/session/${session.id}/publish-assist`, { method: "POST" });
      setStep("publish");
    });
  };

  const activeComparables = useMemo(() => comparables.filter((listing) => !excluded.has(listing.id)), [comparables, excluded]);

  useEffect(() => {
    if (!session || step !== "pricing" || comparables.length === 0) return;
    let cancelled = false;
    api<PriceRecommendation>(`/api/session/${session.id}/price-recommendation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludedListingIds: [...excluded] })
    })
      .then((price) => {
        if (cancelled) return;
        setPriceRecommendation(price);
        if (!priceEdited && price.suggestedPrice) {
          setProductForm((current) => ({ ...current, price: String(price.suggestedPrice) }));
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session, step, comparables, excluded, priceEdited]);

  return (
    <main>
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={20} />
          <span>Verkaufsassistent</span>
        </div>
        <nav>
          {[
            ["upload", "Bilder"],
            ["analysis", "Produkt"],
            ["pricing", "Marktpreise"],
            ["draft", "Anzeige"],
            ["publish", "Assist"]
          ].map(([id, label]) => (
            <button key={id} className={step === id ? "active" : ""} onClick={() => openStep(id as Step)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header>
          <div>
            <h1>Kleinanzeigen Verkaufsassistent</h1>
            <p>Fotos auswerten, Marktpreise vergleichen und die Anzeige vorbereiten.</p>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {busy && (
          <div className="busyOverlay" role="status" aria-live="polite">
            <div className="busyDialog">
              <Loader2 size={34} className="spin" />
              <strong>{busy}</strong>
            </div>
          </div>
        )}

        {step === "upload" && (
          <section
            className="panel dropzone"
            onDrop={(event) => {
              event.preventDefault();
              selectFiles(event.dataTransfer.files);
            }}
            onDragOver={(event) => event.preventDefault()}
          >
            <ImagePlus size={32} />
            {!settings?.hasOpenaiApiKey && (
              <div className="setupPanel">
                <h2>Automatische Analyse aktivieren</h2>
                <p>Für die Bilderkennung braucht die App einen OpenAI API-Key. Der Key wird nur lokal im laufenden Serverprozess gehalten.</p>
                <div className="keyRow">
                  <input
                    type="password"
                    value={apiKey}
                    placeholder="OpenAI API-Key"
                    autoComplete="off"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button className="primary" disabled={apiKey.trim().length < 20 || !!busy} onClick={saveApiKey}>
                    Verbinden
                  </button>
                </div>
              </div>
            )}
            <input id="images" type="file" accept="image/*" multiple onChange={(event) => event.target.files && selectFiles(event.target.files)} />
            <label htmlFor="images">Produktbilder auswählen</label>
            <div className="thumbs">
              {files.map((file, index) => (
                <figure key={`${file.name}-${index}`}>
                  <img src={URL.createObjectURL(file)} alt={`Produktbild ${index + 1}`} title={file.name} />
                </figure>
              ))}
            </div>
            <button className="primary" disabled={!files.length || !settings?.hasOpenaiApiKey || !!busy} onClick={uploadAndAnalyze}>
              <Sparkles size={18} />
              Analyse starten
            </button>
          </section>
        )}

        {step === "analysis" && analysis && (
          <section className="productStep">
            <form className="panel formPanel productForm" onSubmit={(event) => event.preventDefault()}>
              <h2>Produktangaben</h2>
              <div className="formGrid">
                <label>
                  Produkt
                  <input value={productForm.productType} onChange={(event) => setProductForm({ ...productForm, productType: event.target.value })} />
                </label>
                <label>
                  Marke
                  <input value={productForm.brand} onChange={(event) => setProductForm({ ...productForm, brand: event.target.value })} />
                </label>
                <label>
                  Modell
                  <input value={productForm.model} onChange={(event) => setProductForm({ ...productForm, model: event.target.value })} />
                </label>
                <label>
                  Zustand
                  <select
                    value={productForm.condition}
                    onChange={(event) => setProductForm({ ...productForm, condition: event.target.value as ProductAnalysis["condition"] })}
                  >
                    {Object.entries(conditionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spanTwo">
                  Kategorie
                  <input value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} />
                </label>
                <label>
                  Übergabe
                  <select
                    value={productForm.fulfillmentMethod}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        fulfillmentMethod: event.target.value as NonNullable<ProductAnalysis["fulfillmentMethod"]>,
                        notes: withFinalListingLine(productForm.notes, event.target.value as NonNullable<ProductAnalysis["fulfillmentMethod"]>)
                      })
                    }
                  >
                    {Object.entries(fulfillmentLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Preisart
                  <select
                    value={productForm.priceType}
                    onChange={(event) =>
                      setProductForm({ ...productForm, priceType: event.target.value as NonNullable<ProductAnalysis["priceType"]> })
                    }
                  >
                    {Object.entries(priceTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spanTwo">
                  Anzeigenbeschreibung
                  <textarea
                    className="compact"
                    value={productForm.notes}
                    onChange={(event) => setProductForm({ ...productForm, notes: event.target.value })}
                  />
                </label>
              </div>
              <button className="primary nextAction" disabled={!!busy} onClick={searchPrices}>
                <Search size={18} />
                Vergleichsangebote finden
              </button>
            </form>
          </section>
        )}

        {step === "pricing" && (
          <section className="panel">
            <div className="panelHeader">
              <div>
                <h2>Vergleichsangebote</h2>
                <p>{activeComparables.length} Angebote werden für den Preisvorschlag berücksichtigt</p>
              </div>
              {priceRecommendation?.suggestedPrice && (
                <div className="inlinePrice">
                  <span>Preisvorstellung</span>
                  <label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={productForm.price || String(priceRecommendation.suggestedPrice)}
                      onChange={(event) => {
                        setPriceEdited(true);
                        setProductForm({ ...productForm, price: event.target.value });
                      }}
                    />
                    <span>EUR</span>
                  </label>
                </div>
              )}
              <button className="primary" disabled={!comparables.length || !!busy} onClick={generateDraft}>
                <Check size={18} />
                Anzeige vorbereiten
              </button>
            </div>
            <div className="listings">
              {comparables.length === 0 && (
                <div className="emptyState">
                  <h3>Keine Vergleichsangebote gefunden</h3>
                  <p>Prüfe Produkt, Marke und Modell oder versuche allgemeinere Suchbegriffe.</p>
                  {analysis && (
                    <button className="secondary" disabled={!!busy} onClick={searchPrices}>
                      <Search size={18} />
                      Erneut suchen
                    </button>
                  )}
                </div>
              )}
              {comparables.map((listing) => (
                <article key={listing.id} className={excluded.has(listing.id) ? "listing excluded" : "listing"}>
                  <button
                    className="icon"
                    title={excluded.has(listing.id) ? "Wieder einbeziehen" : "Ausschließen"}
                    onClick={() =>
                      setExcluded((current) => {
                        const next = new Set(current);
                        next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id);
                        return next;
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                  <div>
                    <h3>{listing.title}</h3>
                    <p>{listing.location || "Ort unbekannt"} · Score {listing.score.toFixed(2)}</p>
                  </div>
                  <strong>{listing.price ? `${listing.price} EUR` : "VB"}</strong>
                  <a href={listing.url} target="_blank" rel="noreferrer" title="Quelle öffnen">
                    <ExternalLink size={16} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        )}

        {step === "draft" && draft && (
          <section className="grid two">
            <div className="panel">
              <h2>{draft.title}</h2>
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              <button className="primary" disabled={!!busy} onClick={publishAssist}>
                <Send size={18} />
                Nach Prüfung befüllen
              </button>
            </div>
            <div className="panel">
              <h2>Preisvorschlag</h2>
              <div className="price">{draft.price.suggestedPrice ? `${draft.price.suggestedPrice} EUR` : "Offen"}</div>
              <p>{draft.price.rationale}</p>
              <dl>
                <dt>Median</dt>
                <dd>{draft.price.medianPrice ?? "n/a"}</dd>
                <dt>Gewichtete Mitte</dt>
                <dd>{draft.price.weightedMidPrice ?? "n/a"}</dd>
                <dt>Stichprobe</dt>
                <dd>{draft.price.sampleSize}</dd>
              </dl>
            </div>
          </section>
        )}

        {step === "publish" && (
          <section className="panel done">
            <Check size={40} />
            <h2>Browserflow gestartet</h2>
            <p>Der separate Kleinanzeigen-Browser nutzt ein persistentes lokales Profil. Die finale Veröffentlichung bleibt manuell.</p>
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
