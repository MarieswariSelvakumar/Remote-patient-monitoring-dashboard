content = open('main.py', encoding='utf-8').read()
content = content.replace("COALESCE(specialization, 'General') as specialization", "'General' as specialization")
open('main.py', 'w', encoding='utf-8').write(content)
print('Fixed!')
