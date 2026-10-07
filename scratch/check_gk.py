import re

with open('js/generalKnowledgeData.js', 'r', encoding='utf-8') as f:
    text = f.read()

states = re.findall(r"state:\s*'([^']+)'", text)
print('Total states found in GK:', len(states))
print('Unique states in GK:', set(states))

intervals = re.findall(r"interval:\s*(\d+)", text)
print('Total intervals found in GK:', len(intervals))
print('Unique intervals in GK:', set(intervals))

reps = re.findall(r"reps:\s*(\d+)", text)
print('Total reps found in GK:', len(reps))
print('Unique reps in GK:', set(reps))
