import Link from "next/link";
import DashboardClient from "./DashboardClient";
import styles from "./page.module.css";

export default function Page() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>French Mortgage Compass</h1>
        <p className={styles.subtitle}>
          Monitor French mortgage-rate dynamics with macro signals and practical scenario ranges.
        </p>
        <DashboardClient />
        <footer className={styles.footer}>
          <Link href="/mentions" className={styles.footerLink}>
            Legal mentions and credits
          </Link>
        </footer>
      </div>
    </main>
  );
}

