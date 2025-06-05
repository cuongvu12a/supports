import csv
import uuid
from datetime import datetime

from app.services import APIService

SUPPLIER_MAPPING = {
    "TLUS": "6837d8407528138490c80031",
    "SCUS": "6728b154639eef3a738f6f49",
    "DFWUS": "66e0065b9bd01fa00fef6074",
    "MCVN": "66dad3efcdd92285af643843",
    "DODUS": "66ab43845c6b24dc0d49c4b8",
    "MCUS": "667b92e47a56e225be0d2410",
    "PCUK": "666a9e2e3b202b2c0ea029ab",
    "TCVN": "6603874fdb576f701e6e5dbd",
    "BFUS": "66011be5fa0486245cd85acf",
    "MPUS": "654b48bf3f700231f94aee64",
    "VIUS": "6544a283eac9680eab5b5ce6",
    "GTUS": "65187863e1fa814f13ee9e86",
    "TEEU": "650d51d83213238442906b6d",
    "UCUS": "6503fc1b321323ca93900af3",
    "EFUS": "64dc76792505448b061ff39d",
    "PYUS": "64cc7d3a1badf48abe34c0fc",
    "HF EU": "64a625a137babd8326b563a0",
    "GLUS": "644a2baa6af61b7fa79815da",
    "DFUS": "644a2b8a6af61b03a29815d9",
    "FSUS": "6406d946b14f03b986f3bc4b",
    "PBAU": "63fec6e5b14f033a65f3b1b3",
    "WLUS": "63f31975853fa3f8c4cd349f",
    "DTUS": "632d34b4b2338fd02ce36ef8",
    "MDUS": "62ea4633f9e281e09e69955d",
    "SPUS": "62ac08b39a4929c5d544a01c",
    "DBUS": "62a95b1bdb35b84d9be96d55",
    "DPCN": "62a15fc86a85ec61b6664edc",
    "CW": "6234049555fb596c8b7639da",
    "PL EU": "61f24736ba89a666557496ff",
    "ZM - YUN": "610ce1afb1d4352518b42c92",
    "ZM - DHL": "610ce192b1d4356811b42c91",
    "CHR": "610a5a88623b156ddaa66b75",
    "YC": "610265d63a74df3ed7fbf9c5",
    "TZL": "60dc3898a8a879b04008a02d",
    "PF": "60c04267247f9300ef250d3a",
    "Hold": "5ea29c1760243973cdbd30c0",
    "": "5e9c69794ccbe5f2e1ea9375",
    "BG": "5e7d999157d6d87f0573d3c9",
    "1C-Express": "5e6a365af77f4f0848a428f9",
    "CC": "5d6f87fee828741f8a0cc459",
    "PODP01": "5d3a79c475f84bbb42f8af96",
    "PillowProfit": "5cf8be1fab366e2e3ae646c1",
    "PODez": "5cf8bdfeab366e7598e646c0",
    "GearLaunch": "5cf623e09a75d13a4580bb41",
    "1C": "5cf099aa3b7f1e3d46b7ae73",
}

def read_csv(file_path):
    item_by_package = {}
    all_packages_name = []
    partner_sku_by_type = {}
    with open(file_path, mode='r', newline='', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            package_number = row.get("package_number").strip()
            if package_number not in all_packages_name:
                all_packages_name.append(package_number)
            
            if package_number not in item_by_package:
                item_by_package[package_number] = []
            item_by_package[package_number].append(row)
            
            product_type = row.get("product_type").strip()
            partner_sku = row.get("partner_sku").strip()
            supplier_prefix = row.get("supplier_prefix").strip()
            if partner_sku_by_type.get(product_type) is None:
                partner_sku_by_type[product_type] = { "supplier_prefix": supplier_prefix, "partner_skus": [] }
            partner_sku_by_type[product_type]["partner_skus"].append(partner_sku)
    
    return partner_sku_by_type, item_by_package, all_packages_name
            
def get_variant_info(partner_sku_by_type):
    api_service = APIService()
    variant_by_partner_sku = {}
    for product_type, data in partner_sku_by_type.items():
        supplier_prefix = data["supplier_prefix"]
        partner_skus = data["partner_skus"]
        print(f"Processing product type: {product_type}")
        dict_variants = api_service.dict_variants(
            type=product_type,
            supplier_prefix=supplier_prefix,
            supplier_id=SUPPLIER_MAPPING.get(supplier_prefix, ""),
            partner_skus=partner_skus,
        )
        for partner_sku, variants in dict_variants.items():
            if variant_by_partner_sku.get(partner_sku) is not None:
                print(f"Partner SKU {partner_sku} already exists, skipping.")
                continue
            variant_by_partner_sku[partner_sku] = variants
            
    return variant_by_partner_sku
            
def get_package_info_by_name(all_packages_name):
    api_service = APIService()
    package_info_by_name = {}
    packages = api_service.list_packages(
        {
            "names": all_packages_name,
            "package_status": [],
            "extra_status_reason": [],
            "page": 1,
            "limit": 1000
        }
    )
    for package in packages:
        package_id = package.get("_id")
        package_info = api_service.detail_package(package_id)
        package_info_by_name[package.get("name")] = package_info
        
    return package_info_by_name

def handle_package(variant_by_partner_sku, package_info_by_name, package_name,  csv_items):
    api_service = APIService()
    try:
        print(len(csv_items), "items in package", package_name)
        package_info = package_info_by_name.get(package_name)
        if not package_info:
            raise ValueError(f"❌ Package {package_name} not found, skipping.")
        
        address = package_info.get("order", {}).get("address", {})
        if not address:
            raise ValueError(f"❌ Address for package {package_name} not found, skipping.")
        
        name = address.get("full_name")
        address1 = address.get("address")
        address2 = address.get("address2")
        city = address.get("city")
        state = address.get("state")
        phone = address.get("phone")        
        country = address.get("country")
        postal_code = address.get("postal_code")
        email = address.get("email")
        country_code = address.get("country_code")
        supplier = SUPPLIER_MAPPING.get(csv_items[0].get("supplier_prefix", "").strip(), "")
        if not supplier:
            raise ValueError(f"❌ Supplier for package {package_name} not found, skipping.")
        
        format_items = []
        package_items = package_info.get("items", [])
        for item in package_items:
            fulfillment_items = item.get("fulfillmentItems", [])
            for fulfillment_item in fulfillment_items:
                variant_data = fulfillment_item.get("variant_data", {})
                item_partner_sku = variant_data.get("partner_sku", "")
                found = False
                for csv_item in csv_items:
                    current_partner_sku = csv_item.get("current_partner_sku", "").strip()
                    if item_partner_sku == current_partner_sku:
                        found = True
                        
                        item_id = fulfillment_item.get("_id", "")
                        design_front = fulfillment_item.get("design_front", "")
                        design_back = fulfillment_item.get("design_back", "")
                        design_sleeves = fulfillment_item.get("design_sleeves", "")
                        design_hood = fulfillment_item.get("design_hood", "")
                        mockup_front = item.get("product", {}).get("preview", "")
                        mockup_back = ""
                        quantity = fulfillment_item.get("quantity")
                        
                        type = csv_item.get("product_type", "").strip()
                        partner_sku = csv_item.get("partner_sku", "").strip()
                        variant_info = variant_by_partner_sku.get(partner_sku, {})
                        variant_id = variant_info.get("_id", "")
                        variant_as_quantity = variant_info.get("as_quantity")
                        if not all(x is not None for x in [item_id, design_front, design_back, design_sleeves, design_hood, mockup_front, mockup_back, quantity, type, partner_sku, variant_id, variant_as_quantity]):
                            raise ValueError(f"❌ Missing data for item {item_partner_sku} in package {package_name}, skipping.")
                        
                        format_items.append({
                            "_id": item_id,
                            "design_front": design_front,
                            "design_back": design_back,
                            "design_sleeves": design_sleeves,
                            "design_hood": design_hood,
                            "mockup_front": mockup_front,
                            "mockup_back": mockup_back,
                            "quantity": quantity,
                            "type": type,
                            "variant": {
                                "_id": variant_id,
                                "as_quantity": variant_as_quantity,
                            }
                        })
                        
                if not found:
                    raise ValueError(f"❌ Item with partner SKU {item_partner_sku} not found in CSV for package {package_name}, skipping.")
        
        payload = {
            "name": name,
            "address1": address1,
            "address2": address2,
            "city": city,
            "state": state,
            "phone": phone,
            "country": country,
            "postalCode": postal_code,
            "email": email,
            "countryCode": country_code,
            "supplier": supplier,
            "create_invoice": False,
            "reuse_label": False,
            "markFastProduction": False,
            "context": "RemapFromOrderDetailPage",
            "items": format_items,
        }
        package_id = package_info.get("_id", "")
        
        result = api_service.create_replace_package(package_id=package_id, payload=payload, package_name=package_name)
        new_package = result.get("name", "")
        return new_package, None
    except Exception as e:
        return None, str(e)

def save_output(results):
    filename = f"{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex}.csv"
    with open(filename, mode="w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["package_name", "new_package"])
        writer.writerows(results)

def replace_package(file_path):
    try:
        results = []
        created_packages = []
        partner_sku_by_type, item_by_package, all_packages_name = read_csv(file_path)
        variant_by_partner_sku = get_variant_info(partner_sku_by_type)
        package_info_by_name = get_package_info_by_name(all_packages_name)
        
            
        for package_name, csv_items in item_by_package.items():
            new_package, error = handle_package(variant_by_partner_sku, package_info_by_name, package_name, csv_items)
            results.append((package_name, new_package if new_package else error))
            print(f"{package_name} -> {new_package if new_package else error}")
            
            if new_package:
                created_packages.append(new_package)
                
        save_output(results)
        print("Replacement completed successfully.")
        print(f"Original packages: {len(item_by_package)}")
        print(f"Created {len(created_packages)} new packages:")
        print("\n".join(created_packages))
    except Exception as e:
        print(f"Error occurred: {e}")
