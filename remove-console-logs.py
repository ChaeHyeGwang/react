#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re
import os

def remove_console_logs(file_path):
    """파일에서 console.log를 제거합니다."""
    print(f"처리 중: {file_path}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    filtered_lines = []
    
    for i, line in enumerate(lines):
        # console.log로 시작하는 라인 건너뛰기
        if re.search(r'^\s*console\.log\(', line):
            continue
        # console.log가 중간에 있는 경우도 제거 (주석 제외)
        elif 'console.log(' in line and not line.strip().startswith('//'):
            continue
        else:
            filtered_lines.append(line)
    
    # 빈 줄 연속 2개 이상은 1개로
    result = []
    prev_empty = False
    for line in filtered_lines:
        if line.strip() == '':
            if not prev_empty:
                result.append(line)
                prev_empty = True
        else:
            result.append(line)
            prev_empty = False
    
    # 파일에 쓰기
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(result))
    
    removed_count = len(lines) - len(result)
    print(f"  원본 라인 수: {len(lines)}")
    print(f"  처리 후 라인 수: {len(result)}")
    print(f"  제거된 라인 수: {removed_count}")
    return removed_count

# 처리할 파일 목록
files = [
    'client/src/components/DRBet.js',
    'client/src/components/SiteManagement.js',
    'client/src/components/Finish.js',
]

total_removed = 0
for file_path in files:
    full_path = os.path.join(os.path.dirname(__file__), file_path)
    if os.path.exists(full_path):
        removed = remove_console_logs(full_path)
        total_removed += removed
        print()
    else:
        print(f"파일을 찾을 수 없음: {full_path}\n")

print(f"전체 제거된 라인 수: {total_removed}")
print("완료!")

