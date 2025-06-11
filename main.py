from app.actions.convert_dtx import convert_job
from app.actions.replace_package import replace_package

      
def main():
    replace_package('replace_package.csv')
    
#     convert_job(
# {
#   "page": 1,
#   "limit": 10,
#   "request_update_statuses": [
#     "no-request"
#   ],
#   "package_names": [
#     "RB-69673-54899-F1"
#   ],
#   "update_design_count": "",
#   "order_number": "",
#   "show_archive": "hide_archive",
#   "barcode_numbers": "",
#   "namespaces": "",
#   "brand_name": ""
# }
#                 )
    

if __name__ == "__main__":
    main()
