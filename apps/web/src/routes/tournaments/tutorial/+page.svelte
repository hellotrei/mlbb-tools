<section class="tutorial-page">
  <header class="hero">
    <a class="back-link" href="/tournaments">← Kembali ke Tournament</a>
    <h1 class="page-title">Draft Arena Telegram Bot</h1>
    <p class="page-subtitle">
      Ikuti panduan ini untuk membuat event, mengelola ronde, input hasil match, dan menjalankan tournament lewat bot Telegram Draft Arena, baik dari personal chat maupun group.
    </p>
  </header>

  <section class="tutorial-card">
    <h2>Sebelum mulai: format tournament</h2>
    <p>
      Bot Draft Arena mendukung 2 mode event: <strong>Regular Season</strong> dan <strong>Playoffs</strong>. Web dipakai untuk melihat schedule, bracket, dan standings — semua aksi admin dikelola dari bot Telegram.
    </p>
    <ul>
      <li><strong>Scope bot:</strong> bisa dipakai di personal chat atau group Telegram yang berisi <strong>@mlbb_coach_bot</strong>.</li>
      <li><strong>Alur buat event:</strong> admin mengisi nama event, tanggal <code>DD-MM-YYYY</code>, mode event, konfigurasi round/BO sesuai mode, jumlah tim, lalu nama tim.</li>
      <li><strong>Berbagi akses ke group:</strong> creator bisa membuka event dari group untuk membagikan akses manage ke member lain di group yang sama.</li>
      <li><strong>Input hasil:</strong> semua skor diinput dari <strong>POV Team A</strong>, jadi admin cukup klik satu skor untuk match <code>Team A vs Team B</code>.</li>
      <li><strong>Poin standing:</strong> menang = 1, seri = 0.5, kalah = 0, bye = 1.</li>
    </ul>
    <details class="collapsible">
      <summary>Lihat aturan detail (BO, tiebreaker, format, generate round)</summary>
      <div class="collapsible-inner">
        <ul>
          <li><strong>Format Regular Season:</strong> tersedia <code>Round Robin</code>, <code>Double Round Robin</code>, <code>5 Round</code>, <code>Custom Round</code>, dan <code>Swiss Stage</code>.</li>
          <li><strong>Contoh BO:</strong> <code>BO1 → 1-0 / Draw (20m+) / 0-1</code>, <code>BO2 → 2-0 / 1-1 / 0-2</code>, <code>BO3 → 2-0 / 2-1 / 1-2 / 0-2</code>, <code>BO5 → 3-0 / 3-1 / 3-2 / 2-3 / 1-3 / 0-3</code>.</li>
          <li><strong>Aturan BO:</strong> BO genap bisa berakhir seri, BO ganjil selalu menghasilkan pemenang.</li>
          <li><strong>Hasil Regular Season:</strong> selesai di klasemen, lalu Top N tim lolos ke playoffs (default Top 4, bisa dikustom saat buat event). Tidak ada bracket semifinal/final internal di event regular season.</li>
          <li><strong>Generate next round:</strong> <code>Round Robin</code> dan <code>Double Round Robin</code> jadwalnya tetap dan otomatis, sedangkan format fleksibel bisa memilih <code>Default Match</code> atau <code>Shuffle Match</code>.</li>
          <li><strong>Preview sebelum konfirmasi:</strong> untuk <code>5 Round</code>, <code>Custom Round</code>, dan semua Playoffs, bot menampilkan preview pairing sebelum ronde benar-benar dibuat.</li>
          <li><strong>Shuffle guard:</strong> saat memilih <code>Shuffle Match</code>, sistem mengacak ulang pairing sambil menghindari rematch berulang dan pasangan yang sudah bertemu 2x.</li>
          <li><strong>Urutan tiebreaker:</strong> Pts → H2H → Buchholz → Pts Diff → W/L/D/Bye. Nilai Pts Diff positif tampil dengan tanda plus seperti <code>+3</code>.</li>
          <li><strong>Format Playoffs:</strong> tersedia <code>Knockout Single Elimination</code>, <code>Knockout Double Elimination</code>, dan <code>Swiss Stage</code>.</li>
          <li><strong>Single elimination:</strong> menang lanjut, kalah langsung gugur. Mendukung BO terpisah untuk early rounds, semifinal, final, plus opsi 3rd place match.</li>
          <li><strong>Double elimination:</strong> kalah di Upper Bracket turun ke Lower Bracket; kalah lagi baru gugur; pemenang upper dan lower bertemu di Grand Final.</li>
          <li><strong>Swiss Stage:</strong> 16 tim, maks 5 ronde, pairing mengikuti skor yang sama, 3 win = lolos, 3 lose = gugur, match biasa BO1, match penentuan BO3, Top 8 lanjut ke knockout stage.</li>
          <li><strong>Tampilan web playoffs:</strong> bracket konektor penuh untuk <code>Knockout Single Elimination</code>, sedangkan <code>Double Elimination</code> dan <code>Swiss Stage</code> ditampilkan sebagai daftar round berlabel.</li>
        </ul>
      </div>
    </details>
  </section>

  <section class="format-guide-panel">
    <h2 class="format-guide-title">Panduan Detail Format Regular Season</h2>
    <div class="format-guide-list">
      <a class="format-guide-item" href="/tournaments/regular-season-round-robin-rules">
        <span class="format-guide-name">Round Robin</span>
        <span class="format-guide-desc">Semua tim saling bertemu 1x · Jadwal otomatis</span>
      </a>
      <a class="format-guide-item" href="/tournaments/regular-season-double-round-robin-rules">
        <span class="format-guide-name">Double Round Robin</span>
        <span class="format-guide-desc">Semua tim saling bertemu 2x · Home & away</span>
      </a>
      <a class="format-guide-item" href="/tournaments/regular-season-five-round-rules">
        <span class="format-guide-name">5 Round</span>
        <span class="format-guide-desc">Tepat 5 ronde · Pairing manual</span>
      </a>
      <a class="format-guide-item" href="/tournaments/regular-season-custom-round-rules">
        <span class="format-guide-name">Custom Round</span>
        <span class="format-guide-desc">1–10 ronde pilihan admin · Pairing manual</span>
      </a>
      <a class="format-guide-item" href="/tournaments/regular-season-swiss-stage-rules">
        <span class="format-guide-name">Swiss Stage</span>
        <span class="format-guide-desc">16 tim · Pairing berdasarkan skor · 3W lolos / 3L gugur</span>
      </a>
    </div>
  </section>

  <section class="format-guide-panel">
    <h2 class="format-guide-title">Panduan Detail Format Playoffs</h2>
    <div class="format-guide-list">
      <a class="format-guide-item" href="/tournaments/playoffs-single-elimination-rules">
        <span class="format-guide-name">Single Elimination</span>
        <span class="format-guide-desc">Gugur 1x kalah · Bracket konektor penuh · Opsi 3rd Place</span>
      </a>
      <a class="format-guide-item" href="/tournaments/playoffs-double-elimination-rules">
        <span class="format-guide-name">Double Elimination</span>
        <span class="format-guide-desc">Gugur 2x kalah · Upper & Lower Bracket · Grand Final</span>
      </a>
    </div>
  </section>

  <section class="tutorial-card">
    <h2>1. Tambahkan bot</h2>
    <ol>
      <li>Buka Telegram.</li>
      <li>Cari bot Draft Arena di handle <strong>@mlbb_coach_bot</strong>, lalu tekan <code>Start</code>.</li>
      <li>Kalau ingin dipakai di group, tambahkan juga bot <strong>@mlbb_coach_bot</strong> ke group tersebut.</li>
      <li>Setelah bot ada di group, creator dan member di group yang sama bisa mengelola event yang sudah terscope ke group itu.</li>
      <li>
        Setelah <code>/start</code>, bot akan menampilkan 2 menu utama:
        <ul>
          <li><code>Create New Event</code></li>
          <li><code>View Event</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>2. Mengelola event dari group</h2>
    <ol>
      <li>Kalau event dibuat langsung dari group, event otomatis menjadi milik scope group tersebut.</li>
      <li>Creator tetap punya akses manage event itu.</li>
      <li>Member lain di group yang sama juga bisa membuka dan manage event tersebut dari bot.</li>
      <li>Kalau event awalnya dibuat di personal chat, creator bisa share event itu ke group dengan membuka <code>/view_event KODE_EVENT</code> dari group sekali saja.</li>
      <li>Setelah event berhasil dishare ke group, member group bisa lanjut pakai menu <code>View Event</code> untuk mengelola event yang sama.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>3. Buat tournament baru</h2>
    <ol>
      <li>Pilih <code>Create New Event</code> atau ketik <code>/create_new_event</code>.</li>
      <li>Isi <code>Tournament name</code>.</li>
      <li>Isi <code>Event date</code> manual dengan format <code>DD-MM-YYYY</code>.</li>
      <li>
        Pilih <code>mode event</code>:
        <ul>
          <li><code>Regular Season</code></li>
          <li><code>Playoffs</code></li>
        </ul>
      </li>
      <li>
        Kalau memilih <code>Regular Season</code>, pilih format:
        <details class="collapsible">
          <summary>Lihat detail format Regular Season</summary>
          <div class="collapsible-inner">
            <ul>
              <li><code>Round Robin</code>: semua tim bertemu 1x</li>
              <li><code>Double Round Robin</code>: semua tim bertemu 2x dan pertemuan kedua langsung dibalik di ronde setelahnya, jadi kalau ronde ini <code>Team A vs Team B</code> maka ronde berikutnya menjadi <code>Team B vs Team A</code></li>
              <li><code>5 Round</code>: setiap tim cukup main 5 ronde, tidak wajib ketemu semua lawan</li>
              <li><code>Custom Round</code>: kirim manual jumlah ronde dari <code>1</code> sampai <code>10</code></li>
            </ul>
          </div>
        </details>
      </li>
      <li>Untuk <code>Regular Season</code>, pilih <code>Match Best Of</code> dari tombol <code>BO1</code>, <code>BO2</code>, <code>BO3</code>, atau kirim custom BO.</li>
      <li>Kalau pakai custom BO di regular season, ingat: <code>BO</code> genap bisa draw, sedangkan <code>BO</code> ganjil selalu menentukan pemenang.</li>
      <li>Setelah memilih <code>Total teams</code> di <code>Regular Season</code>, bot akan meminta <code>Playoff Advance</code> untuk menentukan berapa tim teratas yang lolos ke playoffs. Default-nya <code>Top 4</code>, tetapi bisa diubah sesuai jumlah tim event.</li>
      <li>
        Untuk <code>Playoffs</code>, pilih dulu sub-mode:
        <ul>
          <li><code>Knockout Single Elimination</code></li>
          <li><code>Knockout Double Elimination</code></li>
          <li><code>Swiss Stage</code></li>
        </ul>
      </li>
      <li>Untuk <code>Playoffs</code> yang sebelumnya didahului <code>Regular Season</code>, bot akan menampilkan preview seeding hasil RS beserta pilihan <strong>seeding policy</strong>:
        <details class="collapsible">
          <summary>Lihat pilihan seeding policy</summary>
          <div class="collapsible-inner">
            <ul>
              <li><code>Balanced</code>: seeding merata antar grup/slot (default)</li>
              <li><code>Strict Rank</code>: urut penuh berdasarkan ranking akhir RS</li>
              <li><code>Avoid Same Group</code>: menghindari pertemuan tim dari group RS yang sama di awal playoff</li>
            </ul>
          </div>
        </details>
        Pilih policy yang sesuai, lalu tekan <code>Gunakan Seed Ini</code> untuk lanjut.
      </li>
      <li><code>Semifinal BO</code> hanya menyediakan <code>BO1</code>, <code>BO3</code>, atau <code>BO5</code>.</li>
      <li><code>Final BO</code> hanya menyediakan <code>BO3</code>, <code>BO5</code>, atau <code>BO7</code>.</li>
      <li>Untuk <code>Knockout Single Elimination</code>, bot juga akan menanyakan apakah bracket memakai <code>3rd Place Match</code>. Jika aktif, Anda akan lanjut memilih <code>3rd Place BO</code>.</li>
      <li>Untuk <code>Knockout Double Elimination</code>, tidak ada menu <code>3rd Place Match</code> karena hasil akhir ditentukan lewat upper bracket, lower bracket, dan grand final.</li>
      <li>Untuk <code>Swiss Stage</code>, jumlah tim saat ini dikunci ke <code>16 tim</code>.</li>
      <li>Untuk <code>Swiss Stage</code>, standard match otomatis <code>BO1</code> dan match penentuan lolos/gugur otomatis <code>BO3</code>.</li>
      <li>Setelah Swiss selesai, <code>Top 8</code> tim lanjut ke knockout stage di event yang sama.</li>
      <li>Pilih <code>Total teams</code> dari tombol <code>8</code>, <code>16</code>, <code>24</code>, atau kirim angka manual.</li>
      <li>Untuk <code>Regular Season</code>, jumlah tim harus genap. Untuk <code>Playoffs</code>, jumlah tim boleh ganjil atau genap.</li>
      <li>
        Kirim <code>team names</code> sesuai jumlah tim.
        Format paling mudah: satu nama tim per baris.
      </li>
      <li>
        Bot akan menampilkan review daftar tim:
        <ul>
          <li><code>Looks Good</code> untuk lanjut</li>
          <li><code>Re-enter Teams</code> untuk ulang</li>
        </ul>
      </li>
      <li>
        Di halaman konfirmasi, Anda bisa:
        <details class="collapsible">
          <summary>Lihat semua opsi edit di halaman konfirmasi</summary>
          <div class="collapsible-inner">
            <ul>
              <li><code>Confirm</code></li>
              <li><code>Edit Name</code></li>
              <li><code>Edit Date</code></li>
              <li><code>Edit Mode</code></li>
              <li><code>Edit Format</code> untuk <code>Regular Season</code> atau sub-format <code>Playoffs</code></li>
              <li><code>Edit Match BO</code></li>
              <li><code>Edit Playoff Advance</code> untuk <code>Regular Season</code></li>
              <li><code>Edit 3rd Place Match</code> untuk <code>Playoffs</code></li>
              <li><code>Edit Teams Count</code></li>
              <li><code>Edit Team Names</code></li>
              <li><code>Cancel</code></li>
            </ul>
          </div>
        </details>
      </li>
      <li>
        Setelah <code>Confirm</code>, event dibuat dan bot akan memberi:
        <ul>
          <li>kode event</li>
          <li>akses manage event</li>
          <li>tombol <code>Open Web</code></li>
        </ul>
      </li>
      <li>Kalau event dibuat langsung dari group, event otomatis terscope ke group itu sehingga member group yang sama bisa ikut manage.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>4. Lihat dan kelola event</h2>
    <ol>
      <li>Pilih <code>View Event</code> atau ketik <code>/view_event</code>.</li>
      <li>Bot akan menampilkan daftar event yang Anda buat atau yang sudah dishare ke group tersebut.</li>
      <li>Kalau event awalnya dibuat di personal chat, creator bisa membuka event itu sekali dari group memakai <code>/view_event KODE_EVENT</code> untuk share akses manage ke group.</li>
      <li>Pilih event yang mau dikelola.</li>
      <li>
        Di menu event, Anda bisa:
        <ul>
          <li><code>View Standings</code> untuk regular season dan <code>Swiss Stage</code></li>
          <li><code>View Schedule</code> untuk regular season</li>
          <li><code>View Bracket</code> untuk playoffs knockout</li>
          <li><code>View Rounds</code> untuk <code>Swiss Stage</code></li>
          <li><code>Manage Round X</code></li>
          <li><code>Generate Next Round</code> jika masih ada ronde berikutnya</li>
          <li><code>Finish Event</code> jika ronde terakhir sudah selesai semua</li>
          <li><code>Delete Event</code> dengan konfirmasi ulang</li>
          <li><code>✏️ Ganti Nama Tim</code> untuk merename salah satu tim di event</li>
          <li><code>Open Web</code></li>
        </ul>
      </li>
      <li>Flow manage event ini berlaku juga saat event dibuka dari group yang sudah punya akses ke event tersebut.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>5. Input hasil pertandingan</h2>
    <ol>
      <li>Masuk ke <code>Manage Round X</code>.</li>
      <li>Bot akan menampilkan daftar match di ronde itu.</li>
      <li>Pilih match yang ingin diinput.</li>
      <li>Semua pilihan skor ditampilkan dari <code>POV Team A</code>. Jadi kalau match-nya <code>Team A vs Team B</code>, admin cukup pilih hasil untuk <code>Team A</code>.</li>
      <li>
        Contoh pilihan result:
        <details class="collapsible">
          <summary>Lihat contoh pilihan skor per BO</summary>
          <div class="collapsible-inner">
            <ul>
              <li><code>Regular Season BO1</code>: <code>Team A 1-0</code>, <code>Team A Draw (20m+)</code>, atau <code>Team A 0-1</code></li>
              <li><code>BO2</code>: <code>Team A 2-0</code>, <code>Team A 1-1</code>, atau <code>Team A 0-2</code></li>
              <li><code>BO3</code>: <code>Team A 2-0</code>, <code>Team A 2-1</code>, <code>Team A 1-2</code>, atau <code>Team A 0-2</code></li>
              <li><code>BO5</code>: <code>Team A 3-0</code>, <code>Team A 3-1</code>, <code>Team A 3-2</code>, <code>Team A 2-3</code>, <code>Team A 1-3</code>, atau <code>Team A 0-3</code></li>
            </ul>
          </div>
        </details>
      </li>
      <li>Kalau salah input, gunakan <code>Reset Result</code>.</li>
      <li>Untuk match standing, hasil win dihitung <code>1 poin</code>, draw <code>0.5 poin</code>, loss <code>0 poin</code>, dan <code>bye = 1 poin</code>.</li>
      <li>Khusus <code>Regular Season BO1</code>, admin boleh memilih <code>Draw (20m+)</code> bila match berakhir melewati 20 menit.</li>
      <li>Artinya, untuk <code>BO2</code> hasil <code>2-0 = win</code>, <code>1-1 = draw</code>, dan <code>0-2 = loss</code>.</li>
      <li>Di mode <code>Playoffs</code>, BO yang tampil saat input hasil otomatis mengikuti format dan fase ronde aktif: early rounds, semifinal, final, upper bracket, lower bracket, grand final, atau Swiss decider match.</li>
      <li>Ulangi sampai semua match di ronde selesai.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>6. Lanjut ke ronde berikutnya</h2>
    <ol>
      <li>Setelah semua match di ronde aktif selesai, tombol <code>Generate Next Round</code> akan muncul.</li>
      <li>Tekan tombol itu.</li>
      <li>Kalau format regular season adalah <code>Round Robin</code> atau <code>Double Round Robin</code>, bot akan langsung membuat ronde berikutnya dengan jadwal tetap.</li>
      <li>Kalau format regular season adalah <code>5 Round</code> atau <code>Custom Round</code>, atau event berjalan di mode <code>Playoffs</code>, bot akan menampilkan 2 pilihan pairing:
        <ul>
          <li><code>Default Match</code></li>
          <li><code>Shuffle Match</code></li>
        </ul>
      </li>
      <li><code>Default Match</code> akan menampilkan preview pairing ronde berikutnya mengikuti urutan/standing atau seed yang berlaku.</li>
      <li><code>Shuffle Match</code> akan menampilkan preview pairing acak sambil berusaha menghindari rematch berulang dan pair yang sudah bertemu 2x.</li>
      <li>Pada <code>Swiss Stage</code>, round 1 bisa memakai <code>Default Match</code> atau <code>Shuffle Match</code>, lalu ronde berikutnya mengikuti grup skor yang sama sebanyak mungkin.</li>
      <li>Pada <code>Double Elimination</code>, pairing mengikuti perpindahan jalur <code>Upper Bracket</code> ke <code>Lower Bracket</code> sampai <code>Grand Final</code>.</li>
      <li>Setelah preview muncul, admin bisa pilih <code>Confirm Pairings</code> atau <code>Shuffle Match Again</code> sampai pairing sesuai.</li>
      <li>Flow preview ini sudah berlaku dari round 1 untuk <code>5 Round</code>, <code>Custom Round</code>, dan semua sub-mode <code>Playoffs</code>.</li>
      <li>Kalau ronde aktif adalah ronde terakhir dan semua match sudah selesai, tombolnya berubah menjadi <code>Finish Event</code>.</li>
      <li>Lalu ulangi proses input hasil match.</li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>7. Selesaikan tournament</h2>
    <ol>
      <li>Kerjakan semua ronde sampai ronde terakhir selesai.</li>
      <li>Standings akan ter-update berdasarkan hasil match yang sudah masuk.</li>
      <li>Untuk <code>Regular Season</code>, hasil akhir yang dipakai adalah klasemen dan <code>Top N teams advance to playoffs</code> sesuai konfigurasi event.</li>
      <li>Untuk playoffs knockout, hasil akhir mengikuti bracket sampai juara ditentukan.</li>
      <li>Untuk <code>Swiss Stage</code>, hasil Swiss dipakai untuk menentukan <code>Top 8</code> tim yang lanjut ke knockout stage, lalu juara akhir ditentukan setelah knockout selesai.</li>
      <li>Kalau event sudah tidak dipakai lagi, admin juga bisa memakai <code>Delete Event</code> dari menu manage event dan bot akan meminta konfirmasi sebelum benar-benar menghapus event.</li>
      <li>
        Anda bisa cek hasil akhir dari:
        <ul>
          <li><code>View Standings</code> di bot</li>
          <li>halaman web lewat <code>Open Web</code></li>
        </ul>
      </li>
    </ol>
  </section>

  <section class="tutorial-card">
    <h2>Catatan penting</h2>
    <details class="collapsible">
      <summary>Lihat semua catatan</summary>
      <div class="collapsible-inner">
        <ul>
          <li>Pembuat event selalu bisa manage event. Member lain juga bisa manage kalau event itu sudah dishare ke group yang sama.</li>
          <li>Bot bisa dipakai di personal chat maupun di group, jadi manage event tidak harus selalu dilakukan lewat chat pribadi dengan bot.</li>
          <li>Untuk share event lama ke group, creator cukup buka event itu dari group dengan <code>/view_event KODE_EVENT</code> satu kali.</li>
          <li>Preset jumlah tim sekarang adalah <code>8</code>, <code>16</code>, dan <code>24</code>, tetapi tetap ada input custom.</li>
          <li>Untuk <code>Custom Round</code>, input ronde hanya menerima angka <code>1</code> sampai <code>10</code>.</li>
          <li>Jumlah <code>team names</code> harus sama persis dengan <code>total teams</code>.</li>
          <li>Nama tim harus unik.</li>
          <li>Kalau ingin membatalkan flow yang sedang berjalan, gunakan <code>/cancel</code>.</li>
          <li>Gunakan <code>/help</code> untuk menampilkan daftar perintah yang tersedia.</li>
          <li>Saat ronde aktif adalah Grand Final (Knockout Double Elimination), tombol <strong>🎬 Set Grand Final Info</strong> akan muncul di preview pairing. Kamu bisa kirim URL logo Tim A, URL logo Tim B, dan URL YouTube live stream (semua opsional, kirim <code>skip</code> untuk lewati).</li>
        </ul>
      </div>
    </details>
  </section>
</section>

<style>
  .tutorial-page {
    display: grid;
    gap: 16px;
  }

  .hero {
    display: grid;
    gap: 8px;
  }

  .hero > * {
    margin: 0;
  }

  .back-link {
    color: var(--muted);
    font-size: 0.9rem;
    text-decoration: none;
  }

  .format-guide-panel {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .format-guide-title {
    margin: 0;
    font-size: 0.95rem;
    color: var(--muted);
    font-weight: 600;
  }

  .format-guide-list {
    display: grid;
    gap: 8px;
  }

  .format-guide-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(123, 220, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    text-decoration: none;
    color: var(--text);
    transition: border-color 160ms ease-out, background 160ms ease-out;
  }

  .format-guide-item:hover {
    border-color: rgba(123, 220, 255, 0.24);
    background: rgba(12, 24, 46, 0.7);
  }

  .format-guide-name {
    font-size: 0.9rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .format-guide-desc {
    color: var(--muted);
    font-size: 0.82rem;
    text-align: right;
  }

  @media (max-width: 540px) {
    .format-guide-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .format-guide-desc {
      text-align: left;
    }
  }

  .tutorial-card {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
  }

  .tutorial-card h2 {
    margin: 0 0 12px;
    font-size: 1rem;
  }

  .tutorial-card ol,
  .tutorial-card ul {
    margin: 0;
    padding-left: 20px;
    color: var(--muted);
    display: grid;
    gap: 8px;
  }

  .tutorial-card li {
    line-height: 1.5;
  }

  code {
    font-size: 0.92em;
  }

  details.collapsible {
    border: 1px solid rgba(123, 220, 255, 0.1);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
    margin-top: 10px;
    overflow: hidden;
  }

  details.collapsible summary {
    cursor: pointer;
    padding: 9px 12px;
    font-size: 0.86rem;
    color: var(--muted);
    font-weight: 600;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
    transition: color 150ms ease;
  }

  details.collapsible summary:hover {
    color: var(--text);
  }

  details.collapsible summary::-webkit-details-marker {
    display: none;
  }

  details.collapsible summary::before {
    content: '▶';
    font-size: 0.65em;
    flex-shrink: 0;
    transition: transform 200ms ease;
    opacity: 0.6;
  }

  details.collapsible[open] summary::before {
    transform: rotate(90deg);
  }

  .collapsible-inner {
    padding: 4px 12px 12px;
    border-top: 1px solid rgba(123, 220, 255, 0.08);
  }

  .collapsible-inner ul,
  .collapsible-inner ol {
    margin: 8px 0 0;
    padding-left: 20px;
    color: var(--muted);
    display: grid;
    gap: 8px;
  }

  .collapsible-inner li {
    line-height: 1.5;
  }
</style>
