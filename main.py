from app.services import APIService

def confirm_handling(jobs):
    print(f"Found {len(jobs)} jobs to process.")
    print("".join([f"- {job.get('name')}_{job.get('item_number')}\n" for job in jobs]))
    
    confirmation = input("This script will change the type of jobs. Do you want to continue? (Y/N): ")
    if confirmation.lower() != 'y':
        print("Exiting script. No changes made.")        
        exit(0)

def main():
    api_service = APIService()
    jobs = api_service.list_jobs(
        {
  "page": 1,
  "limit": 10,
  "request_update_statuses": [],
  "package_names": [
    "RG-92837-45937-F2",
    "RB-84299-53894-F2",
    "RP-48432-44978-F2"
  ],
  "update_design_count": "",
  "order_number": "",
  "show_archive": "hide_archive",
  "barcode_numbers": "",
  "namespaces": "",
  "brand_name": ""
}
    )

    confirm_handling(jobs)
    for job in jobs:
        # api_service.convert_dtx(job, retry_job=True)
        # api_service.change_type(job, retry_job=True, add_prefix="DZT_")
        api_service.change_type(job, retry_job=False, remove_prefix="DZT_")


if __name__ == "__main__":
    main()
