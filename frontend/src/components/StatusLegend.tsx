import React from 'react';
import styles from './StatusLegend.module.css';

export default function StatusLegend() {
  return (
    <ul className={styles.legend} aria-label="Status legend">
      <li className={styles.item}>
        <span className={`${styles.dot} ${styles.operational}`} aria-hidden="true"></span>
        <span>Operational</span>
      </li>
      <li className={styles.item}>
        <span className={`${styles.dot} ${styles.degraded}`} aria-hidden="true"></span>
        <span>Degraded Performance</span>
      </li>
      <li className={styles.item}>
        <span className={`${styles.dot} ${styles.outage}`} aria-hidden="true"></span>
        <span>Major Outage</span>
      </li>
      <li className={styles.item}>
        <span className={`${styles.dot} ${styles.maintenance}`} aria-hidden="true"></span>
        <span>Maintenance</span>
      </li>
      <li className={styles.item}>
        <span className={`${styles.dot} ${styles.unknown}`} aria-hidden="true"></span>
        <span>Unknown</span>
      </li>
    </ul>
  );
}
