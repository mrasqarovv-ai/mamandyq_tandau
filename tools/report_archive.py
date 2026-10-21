#!/usr/bin/env python3
"""Rebuild human-readable coverage and provenance reports from the shipped archive."""
import csv
import itertools
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUBJECTS = {'mathematics':'Математика','physics':'Физика','chemistry':'Химия',
 'biology':'Биология','informatics':'Информатика','geography':'География',
 'history':'Қазақстан тарихы','kazakh':'Қазақ тілі','russian':'Орыс тілі',
 'english':'Ағылшын тілі','natural-science':'Жаратылыстану','other':'Басқа пәндер'}
STAGES = {'district':'Аудандық / қалалық','regional':'Облыстық',
 'republican':'Республикалық','unknown':'Нақтыланбаған'}


def main():
    archive = json.loads((ROOT/'data/archive.json').read_text())
    documents = archive['documents']
    groups = defaultdict(list)
    for record in documents:
        grades = record.get('grades') or ([record['grade']] if record.get('grade') else [None])
        for grade in grades:
            groups[(record['year'],grade,record['stage'],record['subject'])].append(record)
    combinations = set(itertools.product(
        [f'{year}–{year+1}' for year in range(2020,2027)], [5,6,7,8],
        ['district','regional','republican'], SUBJECTS)) | set(groups)
    with (ROOT/'data/coverage.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['Оқу жылы','Сынып','Кезең','Пән','Тапсырма құжаттары',
            'Жауап/шешім құжаттары','Сұрақтар (тек тексеріліп бөлінген)',
            'Сұрақ саны толық па?','Дереккөз','Мәртебе'])
        for key in sorted(combinations,key=lambda k:(k[0],k[1] or 0,k[2],k[3])):
            year,grade,stage,subject=key
            docs = groups[key]
            answers = [d for d in docs if d.get('materialType') in {'answers','solutions','keys'}]
            questions = sum(len(d.get('questions',[])) for d in docs)
            writer.writerow([year,grade or 'Нақтыланбаған',STAGES[stage],SUBJECTS[subject],
                len(docs)-len(answers),len(answers),questions if questions else 'Нақты есептелмеген',
                'Жоқ',' | '.join(dict.fromkeys(d['sourceUrl'] for d in docs)),
                'Жартылай жинақталды' if docs else 'Тексеруді қажет етеді'])
    target = ROOT/'data/sources.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    target.write_text(json.dumps({'updatedAt':archive['updatedAt'],
        'sources':archive['sources'],
        'documents':[{k:v for k,v in d.items() if k not in {'text','questions'}} for d in documents],
        'unresolved':previous.get('unresolved',[]),
        'sourceLinks':previous.get('sourceLinks',[]),
        'driveFolders':previous.get('driveFolders',[]),
        'countingNote':'Бір түпнұсқа бірнеше сынып/тіл жазбасына бөлінуі мүмкін. Толық сұрақ саны әлі есептелмеген.'},
        ensure_ascii=False,indent=2))
    print(f'Reports rebuilt: {len(combinations)} coverage rows, {len(documents)} source records.')


if __name__ == '__main__':
    main()
