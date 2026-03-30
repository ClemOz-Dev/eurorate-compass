import Link from "next/link";
import styles from "./page.module.css";

export default function MentionsPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Legal Mentions and Credits</h1>
        <p className={styles.subtitle}>
          This page is intended to provide legal information, hosting details, and third-party
          service disclosures.
        </p>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Publisher</h2>
          <p className={styles.text}>TODO: Add publisher identity details.</p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Hosting Provider</h2>
          <p className={styles.text}>TODO: Add hosting provider name and legal details.</p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>AI Provider</h2>
          <p className={styles.text}>Mistral AI (service used for textual synthesis).</p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Data Sources</h2>
          <p className={styles.text}>DBnomics, ECB and Eurostat public statistical data.</p>
        </section>

        <div className={styles.actions}>
          <Link href="/" className={styles.backLink}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
