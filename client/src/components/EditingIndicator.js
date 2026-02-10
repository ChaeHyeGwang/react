import React from 'react';

/**
 * 다른 사용자가 편집 중일 때 표시하는 인디케이터
 * 
 * @param {Object} editor - { user: { displayName }, section, recordId }
 * @param {string} size - 'sm' | 'md' (기본: 'sm')
 */
function EditingIndicator({ editor, size = 'sm' }) {
  if (!editor) return null;

  const sizeClasses = size === 'sm' 
    ? 'text-xs px-1.5 py-0.5' 
    : 'text-sm px-2 py-1';

  return (
    <span 
      className={`inline-flex items-center gap-1 ${sizeClasses} rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700 animate-pulse`}
      title={`${editor.user.displayName}님이 편집 중입니다`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 dark:bg-yellow-400"></span>
      {editor.user.displayName} 편집 중
    </span>
  );
}

export default EditingIndicator;
