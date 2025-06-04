install:
	pip install -r requirements.txt
test:
	python -m pytest __tests__  -v -s
format:
	black app main.py