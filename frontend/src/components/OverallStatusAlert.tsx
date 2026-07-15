import React from 'react';
import styles from './OverallStatusAlert.module.css';

interface OverallStatusAlertProps {
  status: string;
}

export default function OverallStatusAlert({ status }: OverallStatusAlertProps) {
  const messages: { [key: string]: { title: string; description: string } } = {
    operational: {
      title: 'All Systems Operational',
      description: 'All monitored services are operating normally.'
    },
    degraded: {
      title: 'Degraded Performance',
      description: 'Some services are experiencing degraded performance. We are monitoring the situation.'
    },
    outage: {
      title: 'Service Disruption Detected',
      description: 'One or more services are currently experiencing issues. Check below for details.'
    },
    maintenance: {
      title: 'Scheduled Maintenance',
      description: 'Some services are undergoing scheduled maintenance.'
    }
  };

  const message = messages[status] || messages.operational;

  return (
    <div className={`${styles.alert} ${styles[status]}`} role="status">
      <h2>
        <span className={styles.icon} aria-hidden="true"></span>
        {message.title}
      </h2>
      <p>{message.description}</p>
    </div>
  );
}
