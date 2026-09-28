import type { Metadata } from "next";
import type { RowDataPacket } from "mysql2";
import { ClipboardList, Package, Pill, Receipt, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { query, type SqlParam } from "@/lib/db";
import { NAV, ROLE_LABEL } from "@/lib/rbac";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type CountRow = RowDataPacket & { n: number };

async function hitung(sql: string, params: SqlParam[]): Promise<number> {
  const rows = await query<CountRow>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export default async function DashboardPage() {
  const session = await requireSession();
  const site = session.siteId;

  // Angka di bawah ini dibaca langsung dari database — bukan data contoh.
  // Selama modul operasional belum diisi, nilainya memang 0.
  const [kunjunganHariIni, antreanMenunggu, resepMenunggu, tagihanMenunggu, stokMenipis] =
    await Promise.all([
      hitung(
        `SELECT COUNT(*) AS n FROM visits
          WHERE tanggal = CURDATE() AND status <> 'batal'
            AND (? IS NULL OR site_id = ?)`,
        [site, site],
      ),
      hitung(
        `SELECT COUNT(*) AS n FROM queues
          WHERE tanggal = CURDATE() AND status = 'menunggu'
            AND (? IS NULL OR site_id = ?)`,
        [site, site],
      ),
      hitung(
        /*
         * `disiapkan` IKUT dihitung. Sejak farmasi dua tahap, resep berstatus
         * itu sudah divalidasi tetapi obatnya masih di rak menunggu pasien
         * membayar atau mengambilnya — persis yang dimaksud "belum
         * diserahkan". Menghilangkannya membuat angka ini menyusut justru
         * pada tahap di mana pekerjaan farmasi belum selesai.
         */
        `SELECT COUNT(*) AS n FROM prescriptions
          WHERE status IN ('baru','diterima_farmasi','disiapkan')
            AND (? IS NULL OR site_id = ?)`,
        [site, site],
      ),
      hitung(
        `SELECT COUNT(*) AS n FROM billing_transactions
          WHERE status = 'menunggu' AND (? IS NULL OR site_id = ?)`,
        [site, site],
      ),
      hitung(
        `SELECT COUNT(*) AS n
           FROM item_stocks s JOIN items i ON i.id = s.item_id
          WHERE s.qty_on_hand <= i.min_stock AND i.is_active = 1
            AND (? IS NULL OR s.site_id = ?)`,
        [site, site],
      ),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-brand-200 bg-linear-to-br from-brand-50 to-surface">
        <p className="text-h1 text-ink">Selamat datang, {session.nama}</p>
        <p className="mt-1 text-meta text-ink-muted">
          Anda masuk sebagai{" "}
          <span className="font-medium text-brand-700">
            {session.roleNama || ROLE_LABEL[session.role]}
          </span>
          {session.siteNama ? ` di ${session.siteNama}` : " (lintas cabang)"}. Menu
          di samping hanya memuat modul yang menjadi wewenang peran Anda.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Kunjungan Hari Ini" value={kunjunganHariIni} icon={Users} />
        <StatCard label="Antrean Menunggu" value={antreanMenunggu} icon={ClipboardList} />
        <StatCard label="Resep Belum Diserahkan" value={resepMenunggu} icon={Pill} />
        <StatCard label="Tagihan Menunggu" value={tagihanMenunggu} icon={Receipt} />
        <StatCard
          label="Item Stok Menipis"
          value={stokMenipis}
          tone={stokMenipis > 0 ? "warning" : "default"}
          sub={stokMenipis > 0 ? "Perlu restock" : "Semua di atas stok minimum"}
          icon={Package}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardList}>Wewenang peran Anda</CardTitle>
          <Badge variant="brand">{ROLE_LABEL[session.role]}</Badge>
        </CardHeader>
        <p className="mb-3 text-meta text-ink-muted">
          Modul di luar daftar ini tidak dirender di menu dan aksesnya ditolak di
          server — bukan sekadar disembunyikan.
        </p>
        <div className="flex flex-col gap-3">
          {NAV[session.role].map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 text-micro tracking-wide text-ink-faint uppercase">
                {section.title}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {section.items.map((item) => (
                  <span
                    key={item.href}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-alt px-2 py-1 text-meta text-ink-muted"
                  >
                    <item.icon className="size-3.5" aria-hidden />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
