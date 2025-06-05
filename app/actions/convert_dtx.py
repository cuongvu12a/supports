from app.services import APIService

def confirm_handling(jobs):
    print("".join([f"- {job.get('name')}_{job.get('item_number')}\n" for job in jobs]))
    print(f"Found {len(jobs)} jobs to process.")

    confirmation = input(
        "This script will change the type of jobs. Do you want to continue? (Y/N): "
    )
    if confirmation.lower() != "y":
        print("Exiting script. No changes made.")
        exit(0)

def convert_job(payload):
    api_service = APIService()
    jobs = api_service.list_jobs(
      payload
    )

    confirm_handling(jobs)
    for job in jobs:
        # api_service.convert_dtx(job, retry_job=True)
        # api_service.change_type(job, retry_job=True, add_prefix="DZT_")
        api_service.change_type(job, retry_job=False, remove_prefix="DZT_")
