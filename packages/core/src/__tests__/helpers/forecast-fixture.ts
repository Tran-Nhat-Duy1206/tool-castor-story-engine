import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ForecastBranch, ForecastModelBranch, NarrativeForecast } from "../../forecast/schema.js";

export function makeForecastBranch(overrides: Partial<ForecastBranch> = {}): ForecastBranch {
  return {
    branchId: "branch-1",
    title: "Nhan vat chinh chap nhan de nghi",
    premise: "Gia dinh nhan vat chinh o Chuong 13 chap nhan loi de nghi hop tac cua doi thu.",
    beats: [
      { chapter: 13, summary: "Nhan vat chinh ky hop dong hop tac, dong minh tuc gian roi di." },
      { chapter: 14, summary: "Hop tac lam lo diem yeu cua nhan vat chinh, doi thu bat dau tham nhap." },
    ],
    characterDecisions: [
      { character: "Nhan vat chinh", decision: "Chap nhan de nghi de doi lay tai nguyen ngan han" },
    ],
    projectedChanges: {
      characters: ["Uy tin cua nhan vat chinh bi ton hai"],
      relationships: ["Nhan vat chinh va dong minh ran nut"],
      world: ["Can bang the luc Dong Thanh nghieng ve doi thu"],
      hooks: ["hook-03 duoc kich hoat som"],
    },
    risks: [
      { kind: "character", description: "Thiet lap tinh cach nhan vat khong thoa hiep, can dong co manh me hon de giai thich." },
    ],
    uncertainties: ["Chua chac dong minh co lap tuc quay lung hay khong"],
    intentAlignment: { score: 62, rationale: "Lech khoi tuyen bao thu chinh cua tac gia nhung tao duoc kich tinh moi." },
    ...overrides,
  };
}

export function makeModelBranch(overrides: Partial<ForecastBranch> = {}): ForecastModelBranch {
  const { branchId: _branchId, ...rest } = makeForecastBranch(overrides);
  return rest;
}

/** Minimal canonical book on disk for forecast runner tests. */
export async function writeForecastFixtureBook(bookDir: string): Promise<void> {
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await mkdir(join(bookDir, "story", "state"), { recursive: true });
  await mkdir(join(bookDir, "story", "outline"), { recursive: true });

  await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "demo-book", title: "Sach mau", language: "vi" }), "utf-8");
  await writeFile(join(bookDir, "chapters", "0001_mo_dau.md"), "Chuong 1 noi dung chinh van", "utf-8");
  await writeFile(join(bookDir, "chapters", "0002_nang_cap.md"), "Chuong 2 noi dung chinh van", "utf-8");
  await writeFile(join(bookDir, "story", "state", "current_state.json"), JSON.stringify({ facts: ["Nhan vat chinh o Dong Thanh"] }), "utf-8");
  await writeFile(join(bookDir, "story", "state", "hooks.json"), JSON.stringify({ hooks: [] }), "utf-8");
  await writeFile(join(bookDir, "story", "author_intent.md"), "# Y do tac gia\nTuyen bao thu chinh", "utf-8");
  await writeFile(join(bookDir, "story", "current_focus.md"), "# Tieu diem hien tai\nDay manh chuoi bang chung", "utf-8");
  await writeFile(join(bookDir, "story", "current_state.md"), "# Trang thai hien tai\nNhan vat chinh o Dong Thanh", "utf-8");
  await writeFile(join(bookDir, "story", "pending_hooks.md"), "| hook_id | Mo ta |\n| --- | --- |\n| hook-03 | Di chuc |", "utf-8");
  await writeFile(join(bookDir, "story", "outline", "story_frame.md"), "# Khung cau chuyen\nDo thi bao thu", "utf-8");
}

export async function snapshotCanonicalFiles(bookDir: string): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  await walk(bookDir, bookDir, snapshot);
  return snapshot;
}

async function walk(root: string, dir: string, snapshot: Map<string, string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (rel.startsWith(join("story", "runtime", "narrative-forecasts"))) continue;
    if (entry.isDirectory()) {
      await walk(root, path, snapshot);
    } else {
      snapshot.set(rel, await readFile(path, "utf-8"));
    }
  }
}

export function makeForecast(overrides: Partial<NarrativeForecast> = {}): NarrativeForecast {
  return {
    version: 1,
    forecastId: "fc-20260101000000",
    bookId: "demo-book",
    createdAt: "2026-01-01T00:00:00.000Z",
    language: "vi",
    divergence: "Nhan vat chinh co chap nhan loi de nghi hop tac",
    horizon: 5,
    baseChapter: 12,
    contextFingerprint: "abc123",
    status: "active",
    branches: [
      makeForecastBranch(),
      makeForecastBranch({
        branchId: "branch-2",
        title: "Nhan vat chinh tu choi de nghi",
        premise: "Gia dinh nhan vat chinh tu choi ngay tai cho va cong khai diem yeu cua doi thu.",
        intentAlignment: { score: 88, rationale: "Tiep noi tuyen bao thu, phu hop voi tieu diem hien tai." },
      }),
    ],
    ...overrides,
  };
}
