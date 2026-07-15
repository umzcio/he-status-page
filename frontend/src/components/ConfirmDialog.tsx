'use client';

import React, { useId } from 'react';
import AccessibleDialog from './AccessibleDialog';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const descId = useId();

  return (
    <AccessibleDialog
      title={title}
      onClose={onCancel}
      role="alertdialog"
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
      descriptionId={descId}
    >
      <h2 className={styles.title}>{title}</h2>
      <p id={descId} className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button onClick={onCancel} className={styles.cancelBtn}>
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className={destructive ? styles.destructiveBtn : styles.confirmBtn}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </AccessibleDialog>
  );
}
